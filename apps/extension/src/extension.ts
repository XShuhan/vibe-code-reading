import * as vscode from "vscode";

import { COMMANDS, VIEWS } from "@code-vibe/shared";
import { createWorkspacePersistence, ensureWorkspaceStorage } from "@code-vibe/persistence";

import { VibeCodeLensProvider } from "./editor/codeLensProvider";
import { ThreadCodeLensProvider } from "./editor/threadCodeLensProvider";
import { ThreadMarkerDecorations } from "./editor/threadMarkerDecorations";
import { openCitation } from "./editor/sourceJump";
import { registerAddThreadAnswerToCanvasCommand } from "./commands/addThreadAnswerToCanvas";
import { registerAskAboutSelectionCommand } from "./commands/askAboutSelection";
import { registerConfigureModelCommand } from "./commands/configureModel";
import { registerDeleteThreadCommand } from "./commands/deleteThread";
import { registerExplainCurrentSymbolCommand } from "./commands/explainCurrentSymbol";
import { registerGoToCodeFromThreadCommand } from "./commands/goToCodeFromThread";
import { registerOpenCanvasCommand } from "./commands/openCanvas";
import { registerOpenProjectOverviewCommand } from "./commands/openProjectOverview";
import { registerOpenThreadFromCodeCommand } from "./commands/openThreadFromCode";
import { registerRefreshIndexCommand } from "./commands/refreshIndex";
import { registerSaveSelectionAsCardCommand } from "./commands/saveSelectionAsCard";
import { registerTestModelConnectionCommand } from "./commands/testModelConnection";
import { registerTraceCallPathCommand } from "./commands/traceCallPath";
import { promptForInitialModelSetup } from "./config/settings";
import { CardService } from "./services/cardService";
import { CanvasService } from "./services/canvasService";
import { CodeThreadMappingService } from "./services/codeThreadMappingService";
import { IndexService } from "./services/indexService";
import { ProjectOverviewService } from "./services/projectOverviewService";
import { ThreadService } from "./services/threadService";
import { VibeController } from "./services/vibeController";
import { CardsViewProvider } from "./views/cardsView";
import { MapViewProvider } from "./views/mapView";
import { ThreadsViewProvider } from "./views/threadsView";
import { prepareWorkspaceStorage } from "./workspaceStorage";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Code Vibe Reading");
  context.subscriptions.push(output);

  // 检查工作区
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    // 注册基本的 views（显示空状态）
    const emptyIndexService = {
      onDidChange: () => new vscode.Disposable(() => {}),
      getIndex: () => null,
      getProjectSummary: () => null,
      getRootPath: () => ""
    } as any as IndexService;
    const emptyProjectOverviewService = {
      onDidChange: () => new vscode.Disposable(() => {}),
      getOverview: () => null,
      getStatus: () => "idle",
      getLastError: () => ""
    } as any as ProjectOverviewService;

    const emptyMapProvider = new MapViewProvider(emptyIndexService, emptyProjectOverviewService);
    const emptyThreadsProvider = new ThreadsViewProvider(null as any);
    const emptyCardsProvider = new CardsViewProvider(null as any);

    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(VIEWS.map, emptyMapProvider),
      vscode.window.registerWebviewViewProvider(VIEWS.threads, emptyThreadsProvider),
      vscode.window.registerTreeDataProvider(VIEWS.cards, emptyCardsProvider)
    );

    vscode.window.showInformationMessage(
      "Code Vibe Reading: Open a workspace folder to start indexing."
    );
    return;
  }

  await promptForInitialModelSetup(context);

  const legacyStorageRoot = (
    context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, "workspace")
  ).fsPath;
  const workspaceStorage = await prepareWorkspaceStorage(
    legacyStorageRoot,
    workspaceFolder.uri.fsPath
  );
  await ensureWorkspaceStorage(workspaceStorage.storageRoot);
  if (workspaceStorage.migrated) {
    output.appendLine(`[storage] migrated legacy data into ${workspaceStorage.workspaceId}`);
  }
  const persistence = createWorkspacePersistence(
    workspaceStorage.storageRoot,
    workspaceStorage.workspaceId
  );

  const indexService = new IndexService(workspaceFolder.uri.fsPath, persistence, output);
  const threadService = new ThreadService(persistence, indexService, output);
  const codeThreadMappingService = new CodeThreadMappingService(persistence, indexService);
  const cardService = new CardService(persistence, indexService);
  const canvasService = new CanvasService(persistence, indexService, cardService);
  const projectOverviewService = new ProjectOverviewService(
    context,
    indexService,
    workspaceStorage.storageRoot,
    output
  );

  await Promise.all([
    indexService.initialize(),
    threadService.initialize(),
    codeThreadMappingService.initialize(),
    cardService.initialize(),
    canvasService.initialize(),
    projectOverviewService.initialize()
  ]);

  const controller = new VibeController(
    context.extensionUri,
    indexService,
    threadService,
    cardService,
    canvasService
  );

  const mapViewProvider = new MapViewProvider(indexService, projectOverviewService);
  const threadsViewProvider = new ThreadsViewProvider(threadService, codeThreadMappingService);
  const cardsViewProvider = new CardsViewProvider(cardService);
  const threadMarkerDecorations = new ThreadMarkerDecorations(
    context.extensionUri,
    codeThreadMappingService,
    threadService
  );

  context.subscriptions.push(
    controller,
    threadMarkerDecorations,
    vscode.window.registerTreeDataProvider(VIEWS.map, mapViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.threads, threadsViewProvider),
    vscode.window.registerTreeDataProvider(VIEWS.cards, cardsViewProvider),
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "typescriptreact" },
        { scheme: "file", language: "javascriptreact" },
        { scheme: "file", language: "python" },
        { scheme: "file", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "file", language: "shellscript" },
        { scheme: "file", language: "json" },
        { scheme: "file", language: "jsonc" }
      ],
      new VibeCodeLensProvider(indexService)
    ),
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "typescriptreact" },
        { scheme: "file", language: "javascriptreact" },
        { scheme: "file", language: "python" },
        { scheme: "file", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "file", language: "shellscript" },
        { scheme: "file", language: "json" },
        { scheme: "file", language: "jsonc" }
      ],
      new ThreadCodeLensProvider(codeThreadMappingService)
    ),
    vscode.languages.registerHoverProvider(
      [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "typescriptreact" },
        { scheme: "file", language: "javascriptreact" },
        { scheme: "file", language: "python" },
        { scheme: "file", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "file", language: "shellscript" },
        { scheme: "file", language: "json" },
        { scheme: "file", language: "jsonc" }
      ],
      threadMarkerDecorations
    ),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await indexService.refreshFile(document.uri);
    }),
    vscode.commands.registerCommand(COMMANDS.openThread, async (thread) => {
      const threadId =
        typeof thread === "string"
          ? thread
          : typeof thread?.threadId === "string"
            ? thread.threadId
            : thread?.id;
      if (!threadId) {
        vscode.window.showWarningMessage("The selected thread could not be found.");
        return;
      }

      await controller.openThread(threadId, {
        viewColumn: typeof thread?.viewColumn === "number" ? thread.viewColumn : undefined,
        preserveFocus: typeof thread?.preserveFocus === "boolean" ? thread.preserveFocus : undefined
      });
    }),
    vscode.commands.registerCommand(COMMANDS.openCard, async (card) => {
      await controller.openCard(card.id);
    }),
    vscode.commands.registerCommand(COMMANDS.openCitation, async (citation) => {
      await openCitation(indexService.getRootPath(), citation);
    })
  );

  registerRefreshIndexCommand(context, indexService, projectOverviewService);
  registerConfigureModelCommand(context);
  registerTestModelConnectionCommand(context, output);
  registerAskAboutSelectionCommand(context, indexService, threadService, codeThreadMappingService, controller);
  registerDeleteThreadCommand(context, threadService, codeThreadMappingService, () => threadsViewProvider.getSelectedThread());
  registerExplainCurrentSymbolCommand(context, indexService, threadService, codeThreadMappingService, controller);
  registerOpenThreadFromCodeCommand(context, codeThreadMappingService, threadService, controller);
  registerGoToCodeFromThreadCommand(
    context,
    indexService,
    threadService,
    codeThreadMappingService,
    () => threadsViewProvider.getSelectedThread()
  );
  registerSaveSelectionAsCardCommand(context, indexService, cardService, controller);
  registerAddThreadAnswerToCanvasCommand(context, threadService, cardService, canvasService, controller);
  registerOpenCanvasCommand(context, controller);
  registerOpenProjectOverviewCommand(context, indexService, projectOverviewService);
  registerTraceCallPathCommand(context, indexService, cardService, controller);
}

export function deactivate(): void {}
