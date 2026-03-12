import type { WorkspaceIndex } from "@code-vibe/shared";
import { describe, expect, it } from "vitest";

import { buildQuestionContext } from "./buildQuestionContext";
import { graphExpansion } from "./graphExpansion";
import { lexicalSearch } from "./lexicalSearch";
import { rankEvidence } from "./rankEvidence";
import { retrieveEvidence } from "./index";

const sampleIndex: WorkspaceIndex = {
  snapshot: {
    id: "workspace_1",
    rootUri: "/tmp/repo",
    revision: "r1",
    languageSet: ["typescript"],
    indexedAt: "2026-03-12T00:00:00.000Z",
    analyzerVersion: "0.1.0"
  },
  nodes: [
    {
      id: "file_auth",
      workspaceId: "workspace_1",
      kind: "file",
      name: "auth.ts",
      path: "src/auth.ts",
      rangeStartLine: 1,
      rangeEndLine: 50,
      exported: true
    },
    {
      id: "fn_createSession",
      workspaceId: "workspace_1",
      kind: "function",
      name: "createSession",
      path: "src/auth.ts",
      rangeStartLine: 5,
      rangeEndLine: 15,
      exported: true,
      parentId: "file_auth",
      signature: "createSession(userId: string): string",
      docComment: "Creates a new session for the user"
    },
    {
      id: "fn_issueToken",
      workspaceId: "workspace_1",
      kind: "function",
      name: "issueToken",
      path: "src/auth.ts",
      rangeStartLine: 20,
      rangeEndLine: 30,
      exported: true,
      parentId: "file_auth",
      signature: "issueToken(userId: string): string"
    },
    {
      id: "fn_validateSession",
      workspaceId: "workspace_1",
      kind: "function",
      name: "validateSession",
      path: "src/auth.ts",
      rangeStartLine: 35,
      rangeEndLine: 45,
      exported: true,
      parentId: "file_auth",
      signature: "validateSession(token: string): string | null"
    },
    {
      id: "file_auth_test",
      workspaceId: "workspace_1",
      kind: "file",
      name: "auth.test.ts",
      path: "src/auth.test.ts",
      rangeStartLine: 1,
      rangeEndLine: 30,
      exported: true
    },
    {
      id: "fn_testCreateSession",
      workspaceId: "workspace_1",
      kind: "function",
      name: "testCreateSession",
      path: "src/auth.test.ts",
      rangeStartLine: 3,
      rangeEndLine: 10,
      exported: false,
      parentId: "file_auth_test"
    }
  ],
  edges: [
    {
      id: "edge_contains_1",
      workspaceId: "workspace_1",
      fromNodeId: "file_auth",
      toNodeId: "fn_createSession",
      type: "contains"
    },
    {
      id: "edge_contains_2",
      workspaceId: "workspace_1",
      fromNodeId: "file_auth",
      toNodeId: "fn_issueToken",
      type: "contains"
    },
    {
      id: "edge_calls",
      workspaceId: "workspace_1",
      fromNodeId: "fn_createSession",
      toNodeId: "fn_issueToken",
      type: "calls"
    },
    {
      id: "edge_tests",
      workspaceId: "workspace_1",
      fromNodeId: "file_auth_test",
      toNodeId: "file_auth",
      type: "tests"
    }
  ],
  fileContents: {
    "src/auth.ts": `
/**
 * Authentication module
 */

export function createSession(userId: string): string {
  // Creates a session by issuing a token
  return issueToken(userId);
}

export function issueToken(userId: string): string {
  return \`token-\${userId}\`;
}

export function validateSession(token: string): string | null {
  return token.startsWith("token-") ? token : null;
}
    `.trim(),
    "src/auth.test.ts": `
import { createSession } from './auth';

test('createSession', () => {
  const token = createSession('user-1');
  expect(token).toBeTruthy();
});
    `.trim()
  }
};

describe("retrieval", () => {
  describe("buildQuestionContext", () => {
    it("builds context from editor state", () => {
      const ctx = buildQuestionContext(
        sampleIndex,
        {
          activeFile: "src/auth.ts",
          startLine: 5,
          endLine: 10,
          selectedText: "createSession",
          currentSymbolId: "fn_createSession"
        },
        "How does session creation work?"
      );

      expect(ctx.workspaceId).toBe("workspace_1");
      expect(ctx.activeFile).toBe("src/auth.ts");
      expect(ctx.activeSymbolId).toBe("fn_createSession");
      expect(ctx.userQuestion).toBe("How does session creation work?");
    });

    it("includes nearby symbols from same file", () => {
      const ctx = buildQuestionContext(
        sampleIndex,
        {
          activeFile: "src/auth.ts",
          startLine: 5,
          endLine: 10,
          selectedText: "createSession"
        },
        "Explain this code"
      );

      // Should include other functions from the same file as nearby
      expect(ctx.nearbySymbolIds.length).toBeGreaterThan(0);
    });
  });

  describe("lexicalSearch", () => {
    it("finds symbols matching query tokens", () => {
      const results = lexicalSearch(sampleIndex, "session creation");
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbolId === "fn_createSession")).toBe(true);
    });

    it("scores exact name matches higher", () => {
      const results = lexicalSearch(sampleIndex, "createSession");
      
      const createSessionResult = results.find(r => r.symbolId === "fn_createSession");
      expect(createSessionResult).toBeTruthy();
      expect(createSessionResult!.score).toBeGreaterThan(0);
    });

    it("includes doc comments in search", () => {
      const results = lexicalSearch(sampleIndex, "Creates a new session");
      
      expect(results.some(r => r.symbolId === "fn_createSession")).toBe(true);
    });

    it("returns empty array for empty query", () => {
      const results = lexicalSearch(sampleIndex, "");
      expect(results).toEqual([]);
    });

    it("returns empty array for no matches", () => {
      const results = lexicalSearch(sampleIndex, "xyznonexistent");
      expect(results).toEqual([]);
    });
  });

  describe("graphExpansion", () => {
    it("returns neighbors for anchor node", () => {
      const results = graphExpansion(sampleIndex, "fn_createSession");
      
      expect(results.length).toBeGreaterThan(0);
      // Should include the function it calls (issueToken)
      expect(results.some(r => r.symbolId === "fn_issueToken")).toBe(true);
    });

    it("returns empty array for no anchor", () => {
      const results = graphExpansion(sampleIndex, undefined);
      expect(results).toEqual([]);
    });

    it("excludes file nodes from results", () => {
      const results = graphExpansion(sampleIndex, "fn_createSession");
      
      // All results should be symbols, not files
      expect(results.every(r => r.symbolId?.startsWith("fn_") || r.symbolId?.startsWith("cls_"))).toBe(true);
    });

    it("assigns higher scores to call edges", () => {
      const results = graphExpansion(sampleIndex, "fn_createSession");
      
      const callResult = results.find(r => r.symbolId === "fn_issueToken");
      expect(callResult).toBeTruthy();
      expect(callResult!.score).toBeGreaterThanOrEqual(6);
    });
  });

  describe("rankEvidence", () => {
    const mockCtx = {
      workspaceId: "workspace_1",
      activeFile: "src/auth.ts",
      activeSelection: {
        startLine: 5,
        endLine: 15,
        text: "createSession"
      },
      activeSymbolId: "fn_createSession",
      nearbySymbolIds: ["fn_issueToken"],
      selectedCardIds: [],
      userQuestion: "How does it work?"
    };

    it("boosts score for active symbol match", () => {
      const candidates = [
        {
          id: "ev1",
          workspaceId: "workspace_1",
          path: "src/auth.ts",
          startLine: 5,
          endLine: 15,
          symbolId: "fn_createSession",
          excerpt: "...",
          score: 5,
          reason: "Initial"
        }
      ];

      const ranked = rankEvidence(sampleIndex, mockCtx, candidates);
      expect(ranked[0].score).toBeGreaterThan(20); // Base + active symbol boost
    });

    it("boosts score for same file", () => {
      const candidates = [
        {
          id: "ev1",
          workspaceId: "workspace_1",
          path: "src/auth.ts",
          startLine: 20,
          endLine: 30,
          symbolId: "fn_issueToken",
          excerpt: "...",
          score: 5,
          reason: "Initial"
        }
      ];

      const ranked = rankEvidence(sampleIndex, mockCtx, candidates);
      expect(ranked[0].score).toBeGreaterThan(5); // Base + same file boost
    });

    it("deduplicates evidence by location", () => {
      const candidates = [
        {
          id: "ev1",
          workspaceId: "workspace_1",
          path: "src/auth.ts",
          startLine: 5,
          endLine: 15,
          symbolId: "fn_createSession",
          excerpt: "...",
          score: 10,
          reason: "First"
        },
        {
          id: "ev2",
          workspaceId: "workspace_1",
          path: "src/auth.ts",
          startLine: 5,
          endLine: 15,
          symbolId: "fn_createSession",
          excerpt: "...",
          score: 5,
          reason: "Duplicate"
        }
      ];

      const ranked = rankEvidence(sampleIndex, mockCtx, candidates);
      expect(ranked.length).toBe(1);
    });

    it("limits results to top 8", () => {
      const candidates = Array.from({ length: 20 }, (_, i) => ({
        id: `ev${i}`,
        workspaceId: "workspace_1",
        path: "src/auth.ts",
        startLine: i,
        endLine: i + 1,
        excerpt: "...",
        score: i,
        reason: "Test"
      }));

      const ranked = rankEvidence(sampleIndex, mockCtx, candidates);
      expect(ranked.length).toBeLessThanOrEqual(8);
    });
  });

  describe("retrieveEvidence", () => {
    it("retrieves evidence for active symbol", () => {
      const ctx = buildQuestionContext(
        sampleIndex,
        {
          activeFile: "src/auth.ts",
          startLine: 5,
          endLine: 15,
          selectedText: "createSession",
          currentSymbolId: "fn_createSession"
        },
        "How does session creation work?"
      );

      const evidence = retrieveEvidence(sampleIndex, ctx);

      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence[0].symbolId).toBe("fn_createSession");
    });

    it("includes graph neighbors", () => {
      const ctx = buildQuestionContext(
        sampleIndex,
        {
          activeFile: "src/auth.ts",
          startLine: 5,
          endLine: 15,
          selectedText: "createSession",
          currentSymbolId: "fn_createSession"
        },
        "How does session creation work?"
      );

      const evidence = retrieveEvidence(sampleIndex, ctx);

      // Should include the called function
      expect(evidence.some(e => e.symbolId === "fn_issueToken")).toBe(true);
    });

    it("includes lexical matches", () => {
      const ctx = buildQuestionContext(
        sampleIndex,
        {
          activeFile: "src/auth.ts",
          startLine: 35,
          endLine: 45,
          selectedText: "validateSession",
          currentSymbolId: "fn_validateSession"
        },
        "session validation"
      );

      const evidence = retrieveEvidence(sampleIndex, ctx);

      // Should include related functions via lexical search
      expect(evidence.some(e => e.symbolId === "fn_createSession")).toBe(true);
    });
  });
});
