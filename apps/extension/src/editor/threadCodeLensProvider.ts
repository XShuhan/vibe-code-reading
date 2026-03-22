import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";

import type { CodeThreadMappingService } from "../services/codeThreadMappingService";

export class ThreadCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly mappingService: CodeThreadMappingService) {
    this.mappingService.onDidChange(() => this.emitter.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return this.mappingService.getMatchesForDocument(document).map((match) => {
      const range = new vscode.Range(
        new vscode.Position(match.location.startLine - 1, 0),
        new vscode.Position(match.location.startLine - 1, 0)
      );
      const count = match.threadIds.length;
      const title = count === 1 ? "Open Thread" : `Show ${count} Threads`;

      return new vscode.CodeLens(range, {
        command: COMMANDS.openThreadFromCode,
        title,
        arguments: [match.location]
      });
    });
  }
}
