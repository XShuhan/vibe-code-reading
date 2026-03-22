import fs from "node:fs/promises";
import path from "node:path";

import type { CanvasState, Card, CodeThreadMapping, Thread, WorkspaceIndex } from "@code-vibe/shared";
import { createId, nowIso } from "@code-vibe/shared";

import { CanvasStore } from "./stores/canvasStore";
import { CardStore } from "./stores/cardStore";
import { CodeThreadMappingStore } from "./stores/codeThreadMappingStore";
import { SnapshotStore } from "./stores/snapshotStore";
import { ThreadStore } from "./stores/threadStore";

export interface PersistenceLayer {
  loadThreads(): Promise<Thread[]>;
  saveThreads(threads: Thread[]): Promise<void>;
  loadCodeThreadMappings(): Promise<CodeThreadMapping[]>;
  saveCodeThreadMappings(mappings: CodeThreadMapping[]): Promise<void>;
  loadCards(): Promise<Card[]>;
  saveCards(cards: Card[]): Promise<void>;
  loadCanvas(): Promise<CanvasState>;
  saveCanvas(canvas: CanvasState): Promise<void>;
  loadIndex(): Promise<WorkspaceIndex | null>;
  saveIndex(index: WorkspaceIndex): Promise<void>;
}

export async function ensureWorkspaceStorage(storageRoot: string): Promise<void> {
  await fs.mkdir(storageRoot, { recursive: true });
}

export function createWorkspacePersistence(
  storageRoot: string,
  workspaceId: string
): PersistenceLayer {
  const threadStore = new ThreadStore(path.join(storageRoot, "threads.json"));
  const codeThreadMappingStore = new CodeThreadMappingStore(path.join(storageRoot, "code-thread-mappings.json"));
  const cardStore = new CardStore(path.join(storageRoot, "cards.json"));
  const canvasStore = new CanvasStore(path.join(storageRoot, "canvas.json"));
  const snapshotStore = new SnapshotStore(path.join(storageRoot, "index.json"));

  return {
    loadThreads: () => threadStore.load(),
    saveThreads: (threads) => threadStore.save(threads),
    loadCodeThreadMappings: () => codeThreadMappingStore.load(),
    saveCodeThreadMappings: (mappings) => codeThreadMappingStore.save(mappings),
    loadCards: () => cardStore.load(),
    saveCards: (cards) => cardStore.save(cards),
    async loadCanvas() {
      const stored = await canvasStore.load();
      return (
        stored ?? {
          id: createId("canvas"),
          workspaceId,
          name: "Reading Canvas",
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          updatedAt: nowIso()
        }
      );
    },
    saveCanvas: (canvas) => canvasStore.save(canvas),
    loadIndex: () => snapshotStore.load(),
    saveIndex: (index) => snapshotStore.save(index)
  };
}

