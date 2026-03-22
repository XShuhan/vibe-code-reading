import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { EditorSelectionState, Thread } from "@code-vibe/shared";

import { ensureModelConfigured } from "../config/settings";
import { getActiveSelectionState } from "../editor/selectionContext";
import type { CodeThreadMappingService } from "../services/codeThreadMappingService";
import type { IndexService } from "../services/indexService";
import type { ThreadService } from "../services/threadService";
import type { VibeController } from "../services/vibeController";

type PanelHydrationPayload = {
  suggestion: string;
  contextLabel: string;
  selectionPreview: string;
};

type InlineHydrationPayload = {
  draft: string;
  cursorPrefix: string;
};

type ComposerMessage =
  | {
      type: "ready";
    }
  | {
      type: "submit";
      payload?: {
        question?: string;
      };
    }
  | {
      type: "cancel";
    };

type InlineComposerMessage = ComposerMessage;

type ExtensionToComposerMessage =
  | {
      type: "hydrate";
      payload: PanelHydrationPayload | InlineHydrationPayload;
    }
  | {
      type: "submitResult";
      payload: {
        ok: boolean;
        error?: string;
      };
    };

type SelectionSnapshot = {
  editor: vscode.TextEditor;
  editorState: EditorSelectionState;
  insetLine: number;
  cursorPrefix: string;
};

type WebviewEditorInsetLike = {
  readonly webview: vscode.Webview;
  readonly onDidDispose: vscode.Event<void>;
  dispose(): void;
};

type CreateWebviewTextEditorInset = (
  editor: vscode.TextEditor,
  line: number,
  height: number,
  options?: vscode.WebviewOptions
) => WebviewEditorInsetLike;

const INLINE_INSET_HEIGHT = 4;
const DEFAULT_INLINE_QUESTION = "解释这段代码的作用";

export function registerAskAboutSelectionCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  controller: VibeController
): void {
  const composer = createSelectionComposer(context, indexService, threadService, mappingService, controller);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.askAboutSelection, async () => {
      await composer.open();
    })
  );
}

export async function askAboutSelection(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  controller: VibeController,
  overrideQuestion?: string
): Promise<Thread | undefined> {
  const editorState = getActiveSelectionState(indexService.getIndex());
  if (!editorState) {
    vscode.window.showWarningMessage("Open a source file inside a workspace before asking Vibe.");
    return undefined;
  }

  const question = overrideQuestion?.trim();
  if (!question) {
    return undefined;
  }

  try {
    return await executeAskAboutSelection(context, threadService, mappingService, controller, editorState, question);
  } catch (error) {
    vscode.window.showErrorMessage(String(error));
    return undefined;
  }
}

function createSelectionComposer(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  controller: VibeController
): {
  open: () => Promise<void>;
} {
  const fallbackComposer = createPanelComposer(context, threadService, mappingService, controller);

  let inlineInset: WebviewEditorInsetLike | undefined;
  let inlineSnapshot: EditorSelectionState | null = null;
  let inlineEditor: vscode.TextEditor | null = null;
  let inlineInsetLine = 0;
  let inlineDraft = "";
  let inlineCursorPrefix = "";
  let inlinePendingHydration: InlineHydrationPayload | null = null;
  let inlineReady = false;
  let inlineInFlight = false;
  let inlineSessionDisposables: vscode.Disposable[] = [];

  const open = async (): Promise<void> => {
    const snapshot = captureSelectionSnapshot(indexService);
    if (!snapshot) {
      vscode.window.showWarningMessage("Open a source file inside a workspace before asking Vibe.");
      return;
    }

    const openedInline = await openInlineComposer(snapshot);
    if (openedInline) {
      fallbackComposer.dispose();
      return;
    }

    await fallbackComposer.open(snapshot.editorState);
  };

  const openInlineComposer = async (snapshot: SelectionSnapshot): Promise<boolean> => {
    if (!getCreateWebviewTextEditorInset()) {
      return false;
    }

    if (inlineInset) {
      inlineInset.dispose();
    }
    resetInlineSession();
    inlineSnapshot = snapshot.editorState;
    inlineEditor = snapshot.editor;
    inlineInsetLine = snapshot.insetLine;
    inlineCursorPrefix = snapshot.cursorPrefix;
    inlineDraft = DEFAULT_INLINE_QUESTION;

    const opened = await createInlineInset();
    if (!opened) {
      resetInlineSession();
      return false;
    }

    registerInlineAutoClose(snapshot.editor);
    return opened;
  };

  const createInlineInset = async (): Promise<boolean> => {
    const createInset = getCreateWebviewTextEditorInset();
    if (!createInset || !inlineEditor || !inlineSnapshot) {
      return false;
    }

    inlinePendingHydration = { draft: inlineDraft, cursorPrefix: inlineCursorPrefix };
    inlineReady = false;

    try {
      const inset = createInset(
        inlineEditor,
        inlineInsetLine,
        INLINE_INSET_HEIGHT,
        { enableScripts: true }
      );
      inlineInset = inset;

      inset.webview.html = renderInlineComposerHtml(inset.webview);
      inset.onDidDispose(() => {
        if (inlineInset === inset) {
          resetInlineSession();
        }
      });
      inset.webview.onDidReceiveMessage((message: InlineComposerMessage) => {
        void handleInlineMessage(inset, message);
      });

      return true;
    } catch {
      return false;
    }
  };

  const handleInlineMessage = async (
    inset: WebviewEditorInsetLike,
    message: InlineComposerMessage
  ): Promise<void> => {
    if (!inlineInset || inlineInset !== inset) {
      return;
    }

    switch (message.type) {
      case "ready":
        inlineReady = true;
        if (inlinePendingHydration) {
          await inset.webview.postMessage({
            type: "hydrate",
            payload: inlinePendingHydration
          } satisfies ExtensionToComposerMessage);
          inlinePendingHydration = null;
        }
        return;
      case "cancel":
        inset.dispose();
        return;
      case "submit": {
        if (inlineInFlight) {
          return;
        }

        const question = message.payload?.question?.trim();
        if (!question) {
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Type a question before sending."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        if (!inlineSnapshot) {
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Selection context is unavailable. Reopen Ask About Selection and try again."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        inlineInFlight = true;
        try {
          const thread = await executeAskAboutSelection(
            context,
            threadService,
            mappingService,
            controller,
            inlineSnapshot,
            question,
            {
              onThreadCreated: () => {
                inset.dispose();
              }
            }
          );
          if (thread) {
            return;
          }
        } catch (error) {
          const errorText = String(error);
          vscode.window.showErrorMessage(errorText);
          await inset.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: errorText
            }
          } satisfies ExtensionToComposerMessage);
        } finally {
          inlineInFlight = false;
        }
        return;
      }
      default:
        return;
    }
  };

  const resetInlineSession = (): void => {
    disposeInlineSessionDisposables();
    inlineInset = undefined;
    inlineSnapshot = null;
    inlineEditor = null;
    inlineInsetLine = 0;
    inlineDraft = "";
    inlineCursorPrefix = "";
    inlinePendingHydration = null;
    inlineReady = false;
    inlineInFlight = false;
  };

  const disposeInlineSessionDisposables = (): void => {
    if (inlineSessionDisposables.length === 0) {
      return;
    }

    vscode.Disposable.from(...inlineSessionDisposables).dispose();
    inlineSessionDisposables = [];
  };

  const registerInlineAutoClose = (editor: vscode.TextEditor): void => {
    disposeInlineSessionDisposables();
    inlineSessionDisposables = [
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!inlineInset) {
          return;
        }

        if (event.textEditor === editor) {
          inlineInset.dispose();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((activeEditor) => {
        if (!inlineInset) {
          return;
        }

        if (!activeEditor || activeEditor !== editor) {
          inlineInset.dispose();
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (!inlineInset) {
          return;
        }

        if (!state.focused) {
          inlineInset.dispose();
        }
      })
    ];
  };

  return { open };
}

function createPanelComposer(
  context: vscode.ExtensionContext,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  controller: VibeController
): {
  open: (editorState: EditorSelectionState) => Promise<void>;
  dispose: () => void;
} {
  let panel: vscode.WebviewPanel | undefined;
  let editorStateSnapshot: EditorSelectionState | null = null;
  let pendingHydration: PanelHydrationPayload | null = null;
  let ready = false;
  let inFlight = false;

  const open = async (editorState: EditorSelectionState): Promise<void> => {
    editorStateSnapshot = editorState;
    const hydratePayload = buildPanelHydrationPayload(editorState);
    pendingHydration = hydratePayload;

    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        "vibe.askComposer",
        "Ask About Selection",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      ready = false;
      panel.webview.html = renderPanelComposerHtml(panel.webview);
      panel.onDidDispose(() => {
        panel = undefined;
        editorStateSnapshot = null;
        pendingHydration = null;
        ready = false;
        inFlight = false;
      });
      panel.webview.onDidReceiveMessage((message: ComposerMessage) => {
        void handlePanelMessage(message);
      });
    } else {
      panel.reveal(vscode.ViewColumn.Active);
    }

    if (ready && panel) {
      await panel.webview.postMessage({
        type: "hydrate",
        payload: hydratePayload
      } satisfies ExtensionToComposerMessage);
      pendingHydration = null;
    }
  };

  const handlePanelMessage = async (message: ComposerMessage): Promise<void> => {
    if (!panel) {
      return;
    }

    switch (message.type) {
      case "ready":
        ready = true;
        if (pendingHydration) {
          await panel.webview.postMessage({
            type: "hydrate",
            payload: pendingHydration
          } satisfies ExtensionToComposerMessage);
          pendingHydration = null;
        }
        return;
      case "cancel":
        panel.dispose();
        return;
      case "submit": {
        if (inFlight) {
          return;
        }

        const question = message.payload?.question?.trim();
        if (!question) {
          await panel.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Type a question before sending."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        if (!editorStateSnapshot) {
          await panel.webview.postMessage({
            type: "submitResult",
            payload: {
              ok: false,
              error: "Selection context is unavailable. Reopen Ask About Selection and try again."
            }
          } satisfies ExtensionToComposerMessage);
          return;
        }

        inFlight = true;
        try {
          const thread = await executeAskAboutSelection(
            context,
            threadService,
            mappingService,
            controller,
            editorStateSnapshot,
            question,
            {
              onThreadCreated: () => {
                panel?.dispose();
              }
            }
          );
          if (thread) {
            return;
          }
        } catch (error) {
          const errorText = String(error);
          vscode.window.showErrorMessage(errorText);
          if (panel) {
            await panel.webview.postMessage({
              type: "submitResult",
              payload: {
                ok: false,
                error: errorText
              }
            } satisfies ExtensionToComposerMessage);
          }
        } finally {
          inFlight = false;
        }
        return;
      }
      default:
        return;
    }
  };

  const dispose = (): void => {
    if (panel) {
      panel.dispose();
    }
  };

  return { open, dispose };
}

function captureSelectionSnapshot(indexService: IndexService): SelectionSnapshot | null {
  const editorState = getActiveSelectionState(indexService.getIndex());
  const editor = vscode.window.activeTextEditor;
  if (!editorState || !editor) {
    return null;
  }

  const active = editor.selection.active;

  return {
    editor,
    editorState,
    insetLine: Math.max(0, Math.min(editor.document.lineCount - 1, active.line)),
    cursorPrefix: getCursorPrefixForAnchor(editor)
  };
}

function getCursorPrefixForAnchor(editor: vscode.TextEditor): string {
  const active = editor.selection.active;
  const line = editor.document.lineAt(active.line).text;
  const rawPrefix = line.slice(0, Math.min(active.character, line.length));
  const tabSizeOption = editor.options.tabSize;
  const tabSize =
    typeof tabSizeOption === "number" && Number.isFinite(tabSizeOption)
      ? Math.max(1, Math.floor(tabSizeOption))
      : 4;
  return rawPrefix.replace(/\t/g, " ".repeat(tabSize));
}

function getCreateWebviewTextEditorInset(): CreateWebviewTextEditorInset | undefined {
  return (
    vscode.window as unknown as {
      createWebviewTextEditorInset?: CreateWebviewTextEditorInset;
    }
  ).createWebviewTextEditorInset;
}

async function executeAskAboutSelection(
  context: vscode.ExtensionContext,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  controller: VibeController,
  editorState: EditorSelectionState,
  question: string,
  options?: {
    onThreadCreated?: () => void;
  }
): Promise<Thread | undefined> {
  const modelConfig = await ensureModelConfigured(context, "ask");
  if (!modelConfig) {
    return undefined;
  }

  const thread = await threadService.askQuestion(question, editorState, modelConfig, {
    onThreadCreated: async (createdThread) => {
      await controller.openThread(createdThread.id);
      options?.onThreadCreated?.();
    }
  });
  await mappingService.addThreadMapping(thread.id, editorState);
  return thread;
}

function buildPanelHydrationPayload(editorState: EditorSelectionState): PanelHydrationPayload {
  return {
    suggestion: editorState.selectedText
      ? "Explain this code and its surrounding behavior"
      : "Explain the current symbol",
    contextLabel: `${editorState.activeFile}:${editorState.startLine}:${editorState.startColumn}-${editorState.endLine}:${editorState.endColumn}`,
    selectionPreview: compactSelectionPreview(editorState.selectedText)
  };
}

function compactSelectionPreview(selectedText: string): string {
  const compact = selectedText.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "No selection preview available.";
  }

  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}

function renderInlineComposerHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Ask About Selection</title>
    <style>
      :root {
        color-scheme: light dark;
        --card-min-width: 300px;
        --card-max-width: 720px;
        --card-outer-gap: 14px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 4px 6px;
        overflow: hidden;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: transparent;
      }

      .shell {
        width: 100%;
        min-width: 0;
      }

      .card {
        display: flex;
        align-items: center;
        gap: 8px;
        width: min(var(--card-min-width), calc(100vw - var(--card-outer-gap) * 2));
        max-width: calc(100vw - var(--card-outer-gap) * 2);
        margin-left: 0;
        border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
        border-radius: 10px;
        padding: 6px 8px;
        background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
      }

      input[type="text"] {
        flex: 1;
        min-width: 0;
        height: 30px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 0 10px;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: var(--vscode-editor-font-size, 13px);
        font-weight: var(--vscode-editor-font-weight, 400);
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
      }

      input[type="text"].hasError {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      }

      button {
        flex: 0 0 auto;
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 6px;
        height: 30px;
        padding: 0 12px;
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .measure {
        position: absolute;
        left: -9999px;
        top: -9999px;
        visibility: hidden;
        pointer-events: none;
        white-space: pre;
        font: inherit;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="card" id="composerCard">
        <input id="questionInput" type="text" placeholder="Press Enter to send, Esc to cancel" />
        <button id="sendButton" type="button">Send</button>
      </div>
      <span id="inputMeasure" class="measure"></span>
      <span id="anchorMeasure" class="measure"></span>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const composerCard = document.getElementById("composerCard");
      const questionInput = document.getElementById("questionInput");
      const sendButton = document.getElementById("sendButton");
      const inputMeasure = document.getElementById("inputMeasure");
      const anchorMeasure = document.getElementById("anchorMeasure");
      let isSending = false;
      let isComposing = false;
      let cursorPrefix = "";

      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
      }

      function readPxVariable(name, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
      }

      function clearInlineError() {
        questionInput.classList.remove("hasError");
        questionInput.removeAttribute("title");
      }

      function setInlineError(message) {
        if (!message) {
          return;
        }
        questionInput.classList.add("hasError");
        questionInput.setAttribute("title", message);
      }

      function syncMeasureStyle() {
        const inputStyles = getComputedStyle(questionInput);
        for (const measure of [inputMeasure, anchorMeasure]) {
          measure.style.font = inputStyles.font;
          measure.style.letterSpacing = inputStyles.letterSpacing;
          measure.style.fontKerning = inputStyles.fontKerning;
        }
      }

      function syncComposerWidth() {
        const outerGap = readPxVariable("--card-outer-gap", 14);
        const configuredMin = readPxVariable("--card-min-width", 300);
        const configuredMax = readPxVariable("--card-max-width", 720);
        const availableWidth = Math.max(220, window.innerWidth - outerGap * 2);
        const minWidth = Math.min(configuredMin, availableWidth);
        const maxWidth = Math.max(minWidth, Math.min(configuredMax, availableWidth));

        inputMeasure.textContent = questionInput.value || questionInput.placeholder || " ";
        const contentWidth = Math.ceil(inputMeasure.getBoundingClientRect().width);
        const chromeWidth = sendButton.getBoundingClientRect().width + 56;
        const nextWidth = clamp(contentWidth + chromeWidth, minWidth, maxWidth);
        composerCard.style.width = nextWidth + "px";
      }

      function syncAnchorOffset() {
        const outerGap = readPxVariable("--card-outer-gap", 14);
        const configuredMin = readPxVariable("--card-min-width", 300);
        const availableWidth = Math.max(220, window.innerWidth - outerGap * 2);
        const fallbackWidth = Math.min(configuredMin, availableWidth);
        const cardWidth = composerCard.getBoundingClientRect().width || fallbackWidth;
        const gutterGuess = 16;

        anchorMeasure.textContent = cursorPrefix || "";
        const prefixWidth = Math.ceil(anchorMeasure.getBoundingClientRect().width);
        const targetLeft = prefixWidth + gutterGuess;
        const maxLeft = Math.max(0, availableWidth - cardWidth);
        const nextLeft = clamp(targetLeft, 0, maxLeft);
        composerCard.style.marginLeft = nextLeft + "px";
      }

      function syncLayout() {
        syncMeasureStyle();
        syncComposerWidth();
        syncAnchorOffset();
      }

      function setSending(next) {
        isSending = next;
        sendButton.disabled = next;
      }

      function submitQuestion() {
        if (isSending) {
          return;
        }

        const question = questionInput.value.trim();
        if (!question) {
          setInlineError("Type a question before sending.");
          return;
        }

        clearInlineError();
        setSending(true);
        vscode.postMessage({
          type: "submit",
          payload: { question: questionInput.value }
        });
      }

      sendButton.addEventListener("click", submitQuestion);

      questionInput.addEventListener("input", () => {
        clearInlineError();
        syncLayout();
      });

      questionInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });

      questionInput.addEventListener("compositionend", () => {
        isComposing = false;
      });

      questionInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          if (isComposing || event.isComposing) {
            return;
          }

          event.preventDefault();
          submitQuestion();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("resize", syncLayout);

      window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.type === "hydrate") {
          questionInput.value = message.payload.draft || "";
          cursorPrefix = typeof message.payload.cursorPrefix === "string" ? message.payload.cursorPrefix : "";
          setSending(false);
          clearInlineError();
          syncLayout();
          questionInput.focus();
          questionInput.setSelectionRange(0, questionInput.value.length);
        }

        if (message.type === "submitResult") {
          if (!message.payload.ok) {
            setInlineError(message.payload.error || "Failed to send question.");
            setSending(false);
          }
        }
      });

      syncLayout();
      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function renderPanelComposerHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Ask About Selection</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 16px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }

      .shell {
        display: grid;
        gap: 10px;
      }

      .label {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
      }

      .context {
        margin: 0;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
        font-family: var(--vscode-editor-font-family, Consolas, monospace);
        font-size: 12px;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
      }

      textarea {
        width: 100%;
        min-height: 78px;
        resize: vertical;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 10px;
        font: inherit;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .hint {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .spacer {
        flex: 1;
      }

      button {
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 6px;
        padding: 6px 12px;
        font: inherit;
        cursor: pointer;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .error {
        min-height: 16px;
        margin: 0;
        color: var(--vscode-errorForeground);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div>
        <p class="label">Selection Snapshot</p>
        <p class="context" id="contextLabel"></p>
        <p class="context" id="selectionPreview"></p>
      </div>

      <div>
        <p class="label">Question</p>
        <textarea id="questionInput" placeholder="Ask what you want to understand about this selection"></textarea>
      </div>

      <p class="error" id="errorText"></p>

      <div class="row">
        <p class="hint">Enter to send, Shift+Enter for newline, Esc to cancel</p>
        <div class="spacer"></div>
        <button id="sendButton" type="button">Send</button>
      </div>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const contextLabel = document.getElementById("contextLabel");
      const selectionPreview = document.getElementById("selectionPreview");
      const questionInput = document.getElementById("questionInput");
      const sendButton = document.getElementById("sendButton");
      const errorText = document.getElementById("errorText");
      let isSending = false;

      function setSending(next) {
        isSending = next;
        sendButton.disabled = next;
      }

      function submitQuestion() {
        if (isSending) {
          return;
        }

        const question = questionInput.value.trim();
        if (!question) {
          errorText.textContent = "Type a question before sending.";
          return;
        }

        errorText.textContent = "";
        setSending(true);
        vscode.postMessage({
          type: "submit",
          payload: { question: questionInput.value }
        });
      }

      sendButton.addEventListener("click", submitQuestion);

      questionInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitQuestion();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          vscode.postMessage({ type: "cancel" });
        }
      });

      window.addEventListener("message", (event) => {
        const message = event.data;

        if (message.type === "hydrate") {
          contextLabel.textContent = message.payload.contextLabel;
          selectionPreview.textContent = message.payload.selectionPreview;
          questionInput.value = message.payload.suggestion;
          errorText.textContent = "";
          setSending(false);
          questionInput.focus();
          questionInput.setSelectionRange(questionInput.value.length, questionInput.value.length);
        }

        if (message.type === "submitResult") {
          if (!message.payload.ok) {
            errorText.textContent = message.payload.error || "Failed to send question.";
            setSending(false);
          }
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function createNonce(length = 24): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return value;
}
