import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { Thread } from "@code-vibe/shared";

import type { CodeThreadMappingService } from "../services/codeThreadMappingService";
import type { ThreadService } from "../services/threadService";

type ThreadsViewMessage =
  | {
      type: "ready";
    }
  | {
      type: "thread.select";
      payload: {
        threadId: string;
      };
    }
  | {
      type: "thread.open";
      payload: {
        threadId: string;
        withCode: boolean;
      };
    }
  | {
      type: "thread.delete";
      payload: {
        threadId: string;
      };
    };

export class ThreadsViewProvider implements vscode.WebviewViewProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  private selectedThread: Thread | undefined;
  private view: vscode.WebviewView | undefined;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly threadService: ThreadService | null,
    private readonly mappingService?: CodeThreadMappingService
  ) {
    this.threadService?.onDidChange(() => void this.refresh());
    this.mappingService?.onDidChange(() => void this.refresh());
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true
    };
    view.webview.html = this.render();
    view.webview.onDidReceiveMessage((message: ThreadsViewMessage) => {
      void this.handleMessage(message);
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
  }

  getSelectedThread(): Thread | undefined {
    return this.selectedThread;
  }

  private async refresh(): Promise<void> {
    this.emitter.fire();
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: "threads.update",
      payload: this.serializeThreads()
    });
  }

  private async handleMessage(message: ThreadsViewMessage): Promise<void> {
    if (!this.threadService) {
      return;
    }

    switch (message.type) {
      case "ready":
        if (this.view) {
          await this.view.webview.postMessage({
            type: "threads.update",
            payload: this.serializeThreads()
          });
        }
        return;
      case "thread.select":
        this.selectedThread = this.threadService.getThread(message.payload.threadId);
        return;
      case "thread.open": {
        const thread = this.threadService.getThread(message.payload.threadId);
        this.selectedThread = thread;
        if (!thread) {
          vscode.window.showWarningMessage("The selected thread could not be found.");
          return;
        }

        await vscode.commands.executeCommand(COMMANDS.openThread, {
          threadId: thread.id,
          viewColumn: message.payload.withCode ? vscode.ViewColumn.Beside : undefined,
          preserveFocus: message.payload.withCode
        });
        if (message.payload.withCode) {
          await vscode.commands.executeCommand(COMMANDS.goToCodeFromThread, thread);
        }
        return;
      }
      case "thread.delete": {
        const thread = this.threadService.getThread(message.payload.threadId);
        this.selectedThread = thread;
        if (!thread) {
          vscode.window.showWarningMessage("The selected thread could not be found.");
          return;
        }

        await vscode.commands.executeCommand(COMMANDS.deleteThread, thread);
        return;
      }
      default:
        return;
    }
  }

  private render(): string {
    const nonce = String(Date.now());
    const items = JSON.stringify(this.serializeThreads())
      .replaceAll("<", "\\u003C")
      .replaceAll(">", "\\u003E")
      .replaceAll("&", "\\u0026");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline' ${this.view?.webview.cspSource ?? ""}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 6px 6px 8px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }

      .shell {
        display: grid;
        gap: 4px;
      }

      .list {
        display: grid;
        gap: 4px;
      }

      .item {
        width: 100%;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 7px;
        padding: 6px 7px;
        background: var(--vscode-sideBar-background);
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .item:hover {
        border-color: var(--vscode-focusBorder);
        background: color-mix(in srgb, var(--vscode-list-hoverBackground) 78%, transparent);
      }

      .item.is-selected {
        border-color: var(--vscode-focusBorder);
        background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 72%, transparent);
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .title {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .badge {
        border-radius: 999px;
        padding: 0 5px;
        font-size: 9px;
        line-height: 1.5;
        color: var(--vscode-badge-foreground);
        background: var(--vscode-badge-background);
      }

      .delete-button {
        flex: none;
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        line-height: 1;
      }

      .delete-button:hover {
        color: var(--vscode-errorForeground);
        background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
      }

      .meta {
        margin-top: 3px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .empty {
        padding: 14px 8px;
        border: 1px dashed var(--vscode-panel-border);
        border-radius: 7px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="list" id="list"></section>
    </main>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const list = document.getElementById("list");
      let state = {
        items: ${items},
        selectedThreadId: null
      };

      function render() {
        list.innerHTML = "";
        if (!state.items.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "No threads yet.";
          list.appendChild(empty);
          return;
        }

        for (const item of state.items) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "item";
          if (state.selectedThreadId === item.id) {
            button.classList.add("is-selected");
          }
          button.dataset.threadId = item.id;

          const badge = item.codeLocation ? '<span class="badge">Code</span>' : "";
          const deleteButton = '<button class="delete-button" type="button" title="Delete thread" aria-label="Delete thread">×</button>';
          const meta = item.codeLocation
            ? item.description + " | " + item.codeLocation
            : item.description;
          button.innerHTML =
            '<div class="title-row"><div class="title">' + escapeHtml(item.title) + '</div>' + badge + deleteButton + '</div>' +
            '<div class="meta">' + escapeHtml(meta) + '</div>';

          const deleteElement = button.querySelector(".delete-button");
          if (deleteElement) {
            deleteElement.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              state.selectedThreadId = item.id;
              render();
              vscode.postMessage({ type: "thread.select", payload: { threadId: item.id } });
              vscode.postMessage({ type: "thread.delete", payload: { threadId: item.id } });
            });
          }

          button.addEventListener("click", (event) => {
            const withCode = event.ctrlKey || event.metaKey;
            state.selectedThreadId = item.id;
            render();
            vscode.postMessage({ type: "thread.select", payload: { threadId: item.id } });
            vscode.postMessage({ type: "thread.open", payload: { threadId: item.id, withCode } });
          });

          button.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }

            event.preventDefault();
            const withCode = event.ctrlKey || event.metaKey;
            state.selectedThreadId = item.id;
            render();
            vscode.postMessage({ type: "thread.select", payload: { threadId: item.id } });
            vscode.postMessage({ type: "thread.open", payload: { threadId: item.id, withCode } });
          });

          list.appendChild(button);
        }
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "threads.update") {
          state = {
            ...state,
            items: message.payload
          };
          render();
        }
      });

      render();
      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }

  private serializeThreads(): Array<{
    id: string;
    title: string;
    description: string;
    codeLocation?: string;
  }> {
    return (this.threadService?.getThreads() ?? []).map((thread) => {
      const location = this.mappingService?.getPrimaryLocationForThread(thread.id);
      return {
        id: thread.id,
        title: thread.title,
        description: `${formatQuestionType(thread.questionType)} | ${new Date(thread.updatedAt).toLocaleString()}`,
        codeLocation: location
          ? `${location.filePath}:${location.startLine}:${location.startColumn}`
          : undefined
      };
    });
  }
}

function formatQuestionType(questionType: Thread["questionType"]): string {
  switch (questionType) {
    case "call_flow":
      return "Call Flow";
    case "principle":
      return "Principle";
    case "risk_review":
      return "Risk Review";
    case "module_summary":
      return "Module Summary";
    case "input_output":
      return "Input / Output";
    case "simplified_pseudocode":
      return "Simplified Pseudocode";
    case "performance_considerations":
      return "Performance";
    case "concurrency_state":
      return "Concurrency / State";
    case "testing_notes":
      return "Testing Notes";
    case "refactor_suggestions":
      return "Refactor Suggestions";
    case "explain_code":
      return "Explain Code";
    default:
      return "Thread";
  }
}
