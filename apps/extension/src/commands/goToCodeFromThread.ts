import * as vscode from "vscode";

import { COMMANDS } from "@code-vibe/shared";
import type { Thread } from "@code-vibe/shared";

import { openCodeThreadLocation } from "../editor/sourceJump";
import type { CodeThreadMappingService } from "../services/codeThreadMappingService";
import type { IndexService } from "../services/indexService";
import type { ThreadService } from "../services/threadService";

export function registerGoToCodeFromThreadCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService,
  threadService: ThreadService,
  mappingService: CodeThreadMappingService,
  getSelectedThread: () => Thread | undefined
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.goToCodeFromThread, async (threadArg?: Thread) => {
      const thread = threadArg ?? getSelectedThread();
      if (!thread) {
        vscode.window.showWarningMessage("Select a thread before jumping to code.");
        return;
      }

      if (!threadService.getThread(thread.id)) {
        vscode.window.showWarningMessage("The selected thread could not be found.");
        return;
      }

      const location = mappingService.getPrimaryLocationForThread(thread.id);
      if (!location) {
        vscode.window.showWarningMessage("This thread is not linked to a code location.");
        return;
      }

      try {
        await openCodeThreadLocation(indexService.getRootPath(), location);
      } catch (error) {
        vscode.window.showWarningMessage(`Unable to open the mapped code location: ${String(error)}`);
      }
    })
  );
}
