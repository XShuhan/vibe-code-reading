import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { CodeThreadLocation, Thread } from "@code-vibe/shared";

import type { CodeThreadMappingService } from "../services/codeThreadMappingService";
import type { ThreadService } from "../services/threadService";
import type { VibeController } from "../services/vibeController";
import { resolveLocationRange } from "../editor/sourceJump";

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

const THREAD_PICKER_BASE_HEIGHT = 3;
const THREAD_PICKER_HEIGHT_PER_THREAD = 2;
const THREAD_PICKER_MAX_HEIGHT = 24;
const THREAD_PICKER_MAX_VISIBLE_WITHOUT_SCROLL = 10;

export function registerOpenThreadFromCodeCommand(
  context: vscode.ExtensionContext,
  mappingService: CodeThreadMappingService,
  threadService: ThreadService,
  controller: VibeController
): void {
  let activeInset: WebviewEditorInsetLike | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openThreadFromCode, async (location: CodeThreadLocation) => {
      const threadIds = mappingService.getThreadIdsForLocation(location);
      if (threadIds.length === 0) {
        vscode.window.showWarningMessage("No thread mapping was found for this code location.");
        return;
      }

      if (threadIds.length === 1) {
        if (!threadService.getThread(threadIds[0])) {
          vscode.window.showWarningMessage("The thread mapped to this code location no longer exists.");
          return;
        }

        activeInset?.dispose();
        await controller.openThread(threadIds[0]);
        return;
      }

      const threads = threadIds
        .map((threadId) => threadService.getThread(threadId))
        .filter((thread): thread is Thread => Boolean(thread));
      if (threads.length === 0) {
        vscode.window.showWarningMessage("The threads mapped to this code location are no longer available.");
        return;
      }

      activeInset?.dispose();
      activeInset = await showInlineThreadPicker(location, threads, controller);
      if (!activeInset) {
        vscode.window.showWarningMessage("Unable to show the thread list under this code marker.");
      }
    })
  );
}

async function showInlineThreadPicker(
  location: CodeThreadLocation,
  threads: Thread[],
  controller: VibeController
): Promise<WebviewEditorInsetLike | undefined> {
  const createInset = getCreateWebviewTextEditorInset();
  if (!createInset) {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, location.filePath);
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false
  });
  const range = resolveLocationRange(document, location);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

  const inset = createInset(
    editor,
    Math.min(document.lineCount - 1, Math.max(0, location.startLine - 1)),
    resolveThreadPickerInsetHeight(threads.length),
    { enableScripts: true }
  );
  inset.webview.html = renderThreadPickerHtml(inset.webview, location, threads);
  inset.onDidDispose(() => undefined);
  inset.webview.onDidReceiveMessage(async (message: { type: "openThread" | "close"; threadId?: string }) => {
    if (message.type === "close") {
      inset.dispose();
      return;
    }

    if (message.type === "openThread" && message.threadId) {
      inset.dispose();
      await controller.openThread(message.threadId);
    }
  });

  return inset;
}

function getCreateWebviewTextEditorInset(): CreateWebviewTextEditorInset | undefined {
  return (
    vscode.window as unknown as {
      createWebviewTextEditorInset?: CreateWebviewTextEditorInset;
    }
  ).createWebviewTextEditorInset;
}

function renderThreadPickerHtml(
  webview: vscode.Webview,
  location: CodeThreadLocation,
  threads: Thread[]
): string {
  const nonce = String(Date.now());
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");
  const items = JSON.stringify(
    threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      description: formatThreadDescription(thread)
    }))
  )
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("&", "\\u0026");
  const needsScrollFallback = threads.length > THREAD_PICKER_MAX_VISIBLE_WITHOUT_SCROLL;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 2px 0 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: transparent;
      }
      .menu {
        border: 1px solid var(--vscode-editorHoverWidget-border);
        background: var(--vscode-editorHoverWidget-background);
        border-radius: 10px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.18);
        overflow: hidden;
        width: min(560px, calc(100vw - 12px));
      }
      .header {
        padding: 6px 9px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .items {
        ${needsScrollFallback ? "max-height: 330px; overflow-y: auto;" : ""}
      }
      .item {
        width: 100%;
        display: block;
        border: 0;
        border-top: 1px solid var(--vscode-panel-border);
        padding: 7px 9px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .item:first-of-type { border-top: 0; }
      .item:hover {
        background: var(--vscode-list-hoverBackground);
      }
      .title {
        font-size: 12px;
        font-weight: 600;
      }
      .description {
        margin-top: 4px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        padding: 6px 9px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .close {
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <section class="menu">
      <div class="header">Threads for ${escapeHtml(location.filePath)}:${location.startLine}</div>
      <div class="items" id="items"></div>
      <div class="actions">
        <button class="close" id="closeButton" type="button">Close</button>
      </div>
    </section>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const items = ${items};
      const container = document.getElementById("items");
      const closeButton = document.getElementById("closeButton");

      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";
        button.innerHTML =
          '<div class="title">' + escapeHtml(item.title) + '</div>' +
          '<div class="description">' + escapeHtml(item.description) + '</div>';
        button.addEventListener("click", () => {
          vscode.postMessage({ type: "openThread", threadId: item.id });
        });
        container.appendChild(button);
      }

      closeButton.addEventListener("click", () => {
        vscode.postMessage({ type: "close" });
      });

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }
    </script>
  </body>
</html>`;
}

function formatThreadDescription(thread: Thread): string {
  const typeLabel = thread.questionType ? thread.questionType.replace(/_/g, " ") : "thread";
  return `${typeLabel} | ${new Date(thread.updatedAt).toLocaleString()}`;
}

function resolveThreadPickerInsetHeight(threadCount: number): number {
  return Math.min(
    THREAD_PICKER_MAX_HEIGHT,
    THREAD_PICKER_BASE_HEIGHT + Math.max(1, threadCount) * THREAD_PICKER_HEIGHT_PER_THREAD
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
