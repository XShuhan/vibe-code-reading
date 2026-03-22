import * as vscode from "vscode";

import type { PersistenceLayer } from "@code-vibe/persistence";
import type { CodeThreadLocation, CodeThreadMapping, EditorSelectionState } from "@code-vibe/shared";
import { createId, nowIso } from "@code-vibe/shared";

import type { IndexService } from "./indexService";

export interface CodeThreadLocationMatch {
  location: CodeThreadLocation;
  threadIds: string[];
}

export class CodeThreadMappingService {
  private mappings: CodeThreadMapping[] = [];
  private readonly mappingsByThreadId = new Map<string, CodeThreadMapping[]>();
  private readonly mappingsByFilePath = new Map<string, CodeThreadLocationMatch[]>();
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly persistence: PersistenceLayer,
    private readonly indexService: IndexService
  ) {}

  async initialize(): Promise<void> {
    this.mappings = await this.persistence.loadCodeThreadMappings();
    this.rebuildIndexes();
    this.emitter.fire();
  }

  getPrimaryLocationForThread(threadId: string): CodeThreadLocation | undefined {
    return this.mappingsByThreadId.get(threadId)?.[0]?.location;
  }

  getLocationsForThread(threadId: string): CodeThreadLocation[] {
    return (this.mappingsByThreadId.get(threadId) ?? []).map((mapping) => mapping.location);
  }

  getMatchesForDocument(document: vscode.TextDocument): CodeThreadLocationMatch[] {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    return this.mappingsByFilePath.get(relativePath) ?? [];
  }

  getThreadIdsForLocation(location: CodeThreadLocation): string[] {
    return this.mappings
      .filter((mapping) => isSameLocation(mapping.location, location))
      .map((mapping) => mapping.threadId);
  }

  async addThreadMapping(threadId: string, editorState: EditorSelectionState): Promise<void> {
    const timestamp = nowIso();
    const location: CodeThreadLocation = {
      filePath: editorState.activeFile,
      startLine: editorState.startLine,
      startColumn: editorState.startColumn ?? 1,
      endLine: editorState.endLine,
      endColumn: editorState.endColumn ?? 1,
      anchorText: compactAnchorText(editorState.selectedText)
    };
    const existing = this.mappings.find((mapping) =>
      mapping.threadId === threadId && isSameLocation(mapping.location, location)
    );

    if (existing) {
      existing.updatedAt = timestamp;
      existing.location.anchorText = location.anchorText;
      await this.save();
      return;
    }

    this.mappings = [
      {
        id: createId("mapping"),
        workspaceId: this.indexService.getWorkspaceId(),
        threadId,
        location,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      ...this.mappings
    ];
    await this.save();
  }

  async deleteThreadMappings(threadId: string): Promise<void> {
    const nextMappings = this.mappings.filter((mapping) => mapping.threadId !== threadId);
    if (nextMappings.length === this.mappings.length) {
      return;
    }

    this.mappings = nextMappings;
    await this.save();
  }

  private async save(): Promise<void> {
    await this.persistence.saveCodeThreadMappings(this.mappings);
    this.rebuildIndexes();
    this.emitter.fire();
  }

  private rebuildIndexes(): void {
    this.mappingsByThreadId.clear();
    this.mappingsByFilePath.clear();

    for (const mapping of this.mappings) {
      const threadMappings = this.mappingsByThreadId.get(mapping.threadId) ?? [];
      threadMappings.push(mapping);
      this.mappingsByThreadId.set(mapping.threadId, threadMappings);
    }

    for (const mapping of this.mappings) {
      const fileMatches = this.mappingsByFilePath.get(mapping.location.filePath) ?? [];
      const existing = fileMatches.find((match) => isSameLocation(match.location, mapping.location));
      if (existing) {
        if (!existing.threadIds.includes(mapping.threadId)) {
          existing.threadIds.push(mapping.threadId);
        }
      } else {
        fileMatches.push({
          location: mapping.location,
          threadIds: [mapping.threadId]
        });
      }

      fileMatches.sort(compareLocationMatches);
      this.mappingsByFilePath.set(mapping.location.filePath, fileMatches);
    }
  }
}

function compareLocationMatches(left: CodeThreadLocationMatch, right: CodeThreadLocationMatch): number {
  return (
    left.location.startLine - right.location.startLine ||
    left.location.startColumn - right.location.startColumn ||
    left.location.endLine - right.location.endLine ||
    left.location.endColumn - right.location.endColumn
  );
}

function isSameLocation(left: CodeThreadLocation, right: CodeThreadLocation): boolean {
  return (
    left.filePath === right.filePath &&
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

function compactAnchorText(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }

  return compact.length > 200 ? compact.slice(0, 200) : compact;
}
