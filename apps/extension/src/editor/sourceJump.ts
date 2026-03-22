import * as vscode from "vscode";

import type { Citation, CodeThreadLocation } from "@code-vibe/shared";

const transientHighlightDecoration = vscode.window.createTextEditorDecorationType({
  borderRadius: "3px",
  backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
  borderStyle: "solid",
  borderWidth: "1px"
});
const activeHighlightTimers = new WeakMap<vscode.TextEditor, ReturnType<typeof setTimeout>>();

export async function openCitation(
  rootPath: string,
  citation: Citation
): Promise<void> {
  const fileUri = vscode.Uri.joinPath(vscode.Uri.file(rootPath), citation.path);
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false
  });
  const start = new vscode.Position(Math.max(0, citation.startLine - 1), 0);
  const end = new vscode.Position(Math.max(0, citation.endLine - 1), 999);
  await revealAndHighlight(editor, new vscode.Range(start, end));
}

export async function openSourceLocation(
  rootPath: string,
  relativePath: string,
  line: number
): Promise<void> {
  await openCitation(rootPath, {
    id: `${relativePath}:${line}`,
    path: relativePath,
    startLine: line,
    endLine: line,
    label: `${relativePath}:${line}`
  });
}

export async function openCodeThreadLocation(
  rootPath: string,
  location: CodeThreadLocation
): Promise<void> {
  const fileUri = vscode.Uri.joinPath(vscode.Uri.file(rootPath), location.filePath);
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await resolveCodeEditor(document);
  await highlightCodeThreadLocationInEditor(editor, location, 1800, true);
}

async function revealAndHighlight(editor: vscode.TextEditor, range: vscode.Range): Promise<void> {
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  editor.setDecorations(transientHighlightDecoration, [range]);

  const existingTimer = activeHighlightTimers.get(editor);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    editor.setDecorations(transientHighlightDecoration, []);
    activeHighlightTimers.delete(editor);
  }, 1800);
  activeHighlightTimers.set(editor, timer);
}

export async function highlightCodeThreadLocationInEditor(
  editor: vscode.TextEditor,
  location: CodeThreadLocation,
  durationMs = 1800,
  reveal = false
): Promise<void> {
  const range = resolveLocationRange(editor.document, location);
  editor.selection = new vscode.Selection(range.start, range.end);
  if (reveal) {
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
  editor.setDecorations(transientHighlightDecoration, [range]);

  const existingTimer = activeHighlightTimers.get(editor);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    editor.setDecorations(transientHighlightDecoration, []);
    activeHighlightTimers.delete(editor);
  }, durationMs);
  activeHighlightTimers.set(editor, timer);
}

export function resolveLocationRange(document: vscode.TextDocument, location: CodeThreadLocation): vscode.Range {
  const requestedStartLine = clampLine(location.startLine, document.lineCount);
  const requestedEndLine = clampLine(location.endLine, document.lineCount);
  const requestedRange = createRange(
    document,
    requestedStartLine,
    location.startColumn,
    requestedEndLine,
    location.endColumn
  );

  if (!location.anchorText) {
    return requestedRange;
  }

  const requestedText = document.getText(requestedRange).replace(/\s+/g, " ").trim();
  if (requestedText.includes(location.anchorText)) {
    return requestedRange;
  }

  const fallbackLine = findAnchorLine(document, location.anchorText, requestedStartLine);
  if (fallbackLine === undefined) {
    return requestedRange;
  }

  const lineDelta = fallbackLine - requestedStartLine;
  return createRange(
    document,
    clampLine(location.startLine + lineDelta, document.lineCount),
    location.startColumn,
    clampLine(location.endLine + lineDelta, document.lineCount),
    location.endColumn
  );
}

async function resolveCodeEditor(document: vscode.TextDocument): Promise<vscode.TextEditor> {
  const existingVisibleEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === document.uri.toString()
  );
  if (existingVisibleEditor) {
    await vscode.window.showTextDocument(existingVisibleEditor.document, {
      preview: false,
      viewColumn: existingVisibleEditor.viewColumn
    });
    return existingVisibleEditor;
  }

  const preferredColumn =
    vscode.window.activeTextEditor?.viewColumn ??
    firstVisibleEditorColumn() ??
    vscode.ViewColumn.One;

  return vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: preferredColumn
  });
}

function firstVisibleEditorColumn(): vscode.ViewColumn | undefined {
  return vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme === "file")?.viewColumn;
}

function findAnchorLine(document: vscode.TextDocument, anchorText: string, targetLine: number): number | undefined {
  const searchStart = Math.max(1, targetLine - 20);
  const searchEnd = Math.min(document.lineCount, targetLine + 20);
  for (let line = searchStart; line <= searchEnd; line += 1) {
    const text = document.lineAt(line - 1).text.replace(/\s+/g, " ").trim();
    if (text && anchorText.includes(text)) {
      return line;
    }
    if (text.includes(anchorText)) {
      return line;
    }
  }

  return undefined;
}

function clampLine(line: number, lineCount: number): number {
  return Math.min(Math.max(1, line), Math.max(1, lineCount));
}

function createRange(
  document: vscode.TextDocument,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): vscode.Range {
  const startLineText = document.lineAt(startLine - 1);
  const endLineText = document.lineAt(endLine - 1);
  const start = new vscode.Position(startLine - 1, clampColumn(startColumn, startLineText.text.length));
  const end = new vscode.Position(endLine - 1, clampColumn(endColumn, endLineText.text.length + 1));
  return new vscode.Range(start, end.isBefore(start) ? start : end);
}

function clampColumn(column: number, lineLength: number): number {
  return Math.min(Math.max(0, column - 1), lineLength);
}
