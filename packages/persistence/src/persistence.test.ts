import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { Card, Thread, WorkspaceIndex, CanvasState, CodeThreadMapping } from "@code-vibe/shared";
import { createId, nowIso } from "@code-vibe/shared";

import { createWorkspacePersistence, ensureWorkspaceStorage } from "./index";
import { BaseJsonStore } from "./stores/baseJsonStore";
import { ThreadStore } from "./stores/threadStore";
import { CardStore } from "./stores/cardStore";
import { CanvasStore } from "./stores/canvasStore";
import { CodeThreadMappingStore } from "./stores/codeThreadMappingStore";
import { SnapshotStore } from "./stores/snapshotStore";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-persist-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("BaseJsonStore", () => {
    it("returns fallback when file does not exist", async () => {
      const store = new BaseJsonStore<string[]>(path.join(tempDir, "nonexistent.json"), []);
      const result = await store.load();
      expect(result).toEqual([]);
    });

    it("saves and loads data", async () => {
      const filePath = path.join(tempDir, "data.json");
      const store = new BaseJsonStore<string[]>(filePath, []);
      
      await store.save(["item1", "item2"]);
      const result = await store.load();
      
      expect(result).toEqual(["item1", "item2"]);
    });

    it("creates parent directories when saving", async () => {
      const filePath = path.join(tempDir, "nested", "deep", "data.json");
      const store = new BaseJsonStore<string[]>(filePath, []);
      
      await store.save(["test"]);
      const result = await store.load();
      
      expect(result).toEqual(["test"]);
    });

    it("returns fallback on corrupt JSON", async () => {
      const filePath = path.join(tempDir, "corrupt.json");
      await fs.writeFile(filePath, "not valid json");
      
      const store = new BaseJsonStore<string[]>(filePath, ["fallback"]);
      const result = await store.load();
      
      expect(result).toEqual(["fallback"]);
    });

    it("clones fallback to prevent mutation", async () => {
      const fallback = { items: ["a"] };
      const store = new BaseJsonStore<typeof fallback>(
        path.join(tempDir, "mutate.json"),
        fallback
      );
      
      const result = await store.load();
      result.items.push("b");
      
      // Fallback should not be mutated
      expect(fallback.items).toEqual(["a"]);
    });
  });

  describe("ThreadStore", () => {
    it("saves and loads threads", async () => {
      const store = new ThreadStore(path.join(tempDir, "threads.json"));
      
      const threads: Thread[] = [
        {
          id: createId("thread"),
          workspaceId: "ws-1",
          title: "Auth flow question",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          contextRefs: ["src/auth.ts:1-10"],
          messages: [
            {
              id: createId("msg"),
              role: "user",
              content: "How does auth work?",
              citations: [],
              createdAt: nowIso()
            }
          ]
        }
      ];
      
      await store.save(threads);
      const loaded = await store.load();
      
      expect(loaded).toEqual(threads);
    });

    it("returns empty array when no threads exist", async () => {
      const store = new ThreadStore(path.join(tempDir, "empty.json"));
      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });
  });

  describe("CodeThreadMappingStore", () => {
    it("saves and loads code-thread mappings", async () => {
      const store = new CodeThreadMappingStore(path.join(tempDir, "code-thread-mappings.json"));

      const mappings: CodeThreadMapping[] = [
        {
          id: createId("mapping"),
          workspaceId: "ws-1",
          threadId: "thread-1",
          location: {
            filePath: "src/auth.ts",
            startLine: 10,
            startColumn: 3,
            endLine: 14,
            endColumn: 20,
            anchorText: "function login"
          },
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ];

      await store.save(mappings);
      const loaded = await store.load();

      expect(loaded).toEqual(mappings);
    });
  });

  describe("CardStore", () => {
    it("saves and loads cards", async () => {
      const store = new CardStore(path.join(tempDir, "cards.json"));
      
      const cards: Card[] = [
        {
          id: createId("card"),
          workspaceId: "ws-1",
          type: "ConceptCard",
          title: "Authentication Flow",
          summary: "User login and session management",
          evidenceRefs: [
            { id: "c1", path: "src/auth.ts", startLine: 1, endLine: 20, label: "Auth module" }
          ],
          tags: ["auth", "security"],
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ];
      
      await store.save(cards);
      const loaded = await store.load();
      
      expect(loaded).toEqual(cards);
    });
  });

  describe("CanvasStore", () => {
    it("saves and loads canvas state", async () => {
      const store = new CanvasStore(path.join(tempDir, "canvas.json"));
      
      const canvas: CanvasState = {
        id: createId("canvas"),
        workspaceId: "ws-1",
        name: "My Reading Canvas",
        nodes: [
          {
            id: createId("node"),
            cardId: createId("card"),
            x: 100,
            y: 200,
            width: 260,
            height: 180
          }
        ],
        edges: [
          {
            id: createId("edge"),
            fromNodeId: "node-1",
            toNodeId: "node-2",
            relation: "depends_on"
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: nowIso()
      };
      
      await store.save(canvas);
      const loaded = await store.load();
      
      expect(loaded).toEqual(canvas);
    });

    it("returns null when no canvas exists", async () => {
      const store = new CanvasStore(path.join(tempDir, "nocanvas.json"));
      const loaded = await store.load();
      expect(loaded).toBeNull();
    });
  });

  describe("SnapshotStore", () => {
    it("saves and loads workspace index", async () => {
      const store = new SnapshotStore(path.join(tempDir, "index.json"));
      
      const index: WorkspaceIndex = {
        snapshot: {
          id: "ws-1",
          rootUri: "/tmp/project",
          revision: "abc123",
          languageSet: ["typescript"],
          indexedAt: nowIso(),
          analyzerVersion: "0.1.0"
        },
        nodes: [
          {
            id: "node-1",
            workspaceId: "ws-1",
            kind: "function",
            name: "test",
            path: "src/test.ts",
            rangeStartLine: 1,
            rangeEndLine: 5,
            exported: true
          }
        ],
        edges: [],
        fileContents: {
          "src/test.ts": "export function test() {}"
        }
      };
      
      await store.save(index);
      const loaded = await store.load();
      
      expect(loaded).toEqual(index);
    });
  });

  describe("createWorkspacePersistence", () => {
    it("round-trips all data types", async () => {
      const persistence = createWorkspacePersistence(tempDir, "ws-test");

      const threads: Thread[] = [
        {
          id: createId("thread"),
          workspaceId: "ws-test",
          title: "Test Thread",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          contextRefs: [],
          messages: []
        }
      ];

      const cards: Card[] = [
        {
          id: createId("card"),
          workspaceId: "ws-test",
          type: "ConceptCard",
          title: "Test Card",
          summary: "Test summary",
          evidenceRefs: [],
          tags: ["test"],
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ];

      const index: WorkspaceIndex = {
        snapshot: {
          id: "ws-test",
          rootUri: "/tmp/repo",
          revision: "1",
          languageSet: ["typescript"],
          indexedAt: nowIso(),
          analyzerVersion: "1"
        },
        nodes: [],
        edges: [],
        fileContents: {}
      };

      await persistence.saveThreads(threads);
      await persistence.saveCodeThreadMappings([
        {
          id: createId("mapping"),
          workspaceId: "ws-test",
          threadId: threads[0].id,
          location: {
            filePath: "src/test.ts",
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 1
          },
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ]);
      await persistence.saveCards(cards);
      await persistence.saveIndex(index);

      const canvas = await persistence.loadCanvas();
      canvas.nodes.push({
        id: createId("node"),
        cardId: cards[0].id,
        x: 20,
        y: 20,
        width: 260,
        height: 180
      });
      await persistence.saveCanvas(canvas);

      await expect(persistence.loadThreads()).resolves.toEqual(threads);
      await expect(persistence.loadCodeThreadMappings()).resolves.toHaveLength(1);
      await expect(persistence.loadCards()).resolves.toEqual(cards);
      await expect(persistence.loadIndex()).resolves.toEqual(index);
      await expect(persistence.loadCanvas()).resolves.toEqual(canvas);
    });

    it("provides default canvas when none exists", async () => {
      const persistence = createWorkspacePersistence(tempDir, "ws-new");
      
      const canvas = await persistence.loadCanvas();
      
      expect(canvas.id).toBeTruthy();
      expect(canvas.workspaceId).toBe("ws-new");
      expect(canvas.name).toBe("Reading Canvas");
      expect(canvas.nodes).toEqual([]);
      expect(canvas.edges).toEqual([]);
      expect(canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe("ensureWorkspaceStorage", () => {
    it("creates storage directory", async () => {
      const storagePath = path.join(tempDir, "workspace-storage");
      
      await ensureWorkspaceStorage(storagePath);
      
      const stats = await fs.stat(storagePath);
      expect(stats.isDirectory()).toBe(true);
    });

    it("succeeds when directory already exists", async () => {
      const storagePath = path.join(tempDir, "existing");
      await fs.mkdir(storagePath);
      
      await expect(ensureWorkspaceStorage(storagePath)).resolves.not.toThrow();
    });
  });
});
