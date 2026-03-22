import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { CodeThreadLocation } from "@code-vibe/shared";

import type { CodeThreadMappingService } from "../services/codeThreadMappingService";
import type { ThreadService } from "../services/threadService";
import { highlightCodeThreadLocationInEditor } from "./sourceJump";

export class ThreadMarkerDecorations implements vscode.Disposable, vscode.HoverProvider {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly badgeDecoration: vscode.TextEditorDecorationType;
  private hoverClearTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    extensionUri: vscode.Uri,
    private readonly mappingService: CodeThreadMappingService,
    private readonly threadService: ThreadService
  ) {
    this.badgeDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 12px",
        color: new vscode.ThemeColor("editorInfo-foreground"),
        backgroundColor: new vscode.ThemeColor("editorInfo-background"),
        border: "1px solid",
        borderColor: new vscode.ThemeColor("editorInfo-border"),
        fontWeight: "600"
      },
      gutterIconSize: "contain",
      dark: {
        gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "thread-marker-dark.svg")
      },
      light: {
        gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "thread-marker-light.svg")
      },
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    this.disposables.push(
      this.mappingService.onDidChange(() => this.refreshVisibleEditors()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisibleEditors()),
      vscode.workspace.onDidCloseTextDocument(() => this.refreshVisibleEditors())
    );
    this.refreshVisibleEditors();
  }

  dispose(): void {
    if (this.hoverClearTimer) {
      clearTimeout(this.hoverClearTimer);
    }

    this.badgeDecoration.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const match = this.mappingService.getMatchesForDocument(document).find((item) =>
      position.line >= item.location.startLine - 1 && position.line <= item.location.endLine - 1
    );
    if (!match) {
      return undefined;
    }

    const editor = vscode.window.visibleTextEditors.find((item) => item.document.uri.toString() === document.uri.toString());
    if (editor) {
      void highlightCodeThreadLocationInEditor(editor, match.location, 1400);
      if (this.hoverClearTimer) {
        clearTimeout(this.hoverClearTimer);
      }
      this.hoverClearTimer = setTimeout(() => undefined, 1450);
    }

    const markdown = new vscode.MarkdownString(this.buildHoverMarkdown(match.location), true);
    markdown.isTrusted = true;
    markdown.supportHtml = false;
    return new vscode.Hover(markdown, this.toHoverRange(match.location));
  }

  refreshVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== "file") {
        continue;
      }

      const options = this.mappingService.getMatchesForDocument(editor.document).map((match) => ({
        range: new vscode.Range(
          new vscode.Position(match.location.startLine - 1, 0),
          new vscode.Position(match.location.startLine - 1, 0)
        ),
        renderOptions: {
          after: {
            contentText: match.threadIds.length === 1 ? " Thread" : ` Threads ${match.threadIds.length}`
          }
        },
        hoverMessage: new vscode.MarkdownString(this.buildHoverMarkdown(match.location), true)
      }));
      editor.setDecorations(this.badgeDecoration, options);
    }
  }

  private buildHoverMarkdown(location: CodeThreadLocation): string {
    const threadIds = this.mappingService.getThreadIdsForLocation(location);
    const threads = threadIds
      .map((threadId) => this.threadService.getThread(threadId))
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread));
    const header = `**Threads for \`${location.filePath}:${location.startLine}\`**`;

    if (threads.length === 0) {
      return `${header}\n\nNo threads are available for this code location.`;
    }

    const items = threads.map((thread) => {
      const commandUri = encodeCommandUri(COMMANDS.openThread, [{ id: thread.id }]);
      return `- [${escapeMarkdown(thread.title)}](${commandUri})`;
    });

    return `${header}\n\n${items.join("\n")}`;
  }

  private toHoverRange(location: CodeThreadLocation): vscode.Range {
    return new vscode.Range(
      new vscode.Position(location.startLine - 1, 0),
      new vscode.Position(location.endLine - 1, 0)
    );
  }
}

function encodeCommandUri(command: string, args: unknown[]): vscode.Uri {
  return vscode.Uri.parse(`command:${command}?${encodeURIComponent(JSON.stringify(args))}`);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\[\]\(\)]/g, "\\$&");
}
