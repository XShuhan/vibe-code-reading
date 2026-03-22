import { describe, expect, it } from "vitest";

import type { ModelAdapter } from "@code-vibe/model-gateway";
import type { ModelConfig, ModelInfo, ModelRequest, ModelResponse } from "@code-vibe/shared";

import {
  normalizeSkillSelectionPlan,
  parseSkillSelectionResponse,
  planAskSkillSelection,
  planSkillSelection,
  type SkillSelectionPlan
} from "./skillPlanner";

const MODEL_CONFIG: ModelConfig = {
  provider: "openai-compatible",
  baseUrl: "https://example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  temperature: 0,
  maxTokens: 1024
};

describe("skillPlanner", () => {
  it("accepts valid planner output with secondary skills", () => {
    const plan = normalizeSkillSelectionPlan(
      {
        primarySkillId: "ExplainSkill",
        secondarySkillIds: ["CallFlowSkill", "PrincipleSkill"],
        reason: "Need behavior explanation with upstream context."
      },
      ["ExplainSkill", "CallFlowSkill", "PrincipleSkill", "RiskReviewSkill"] as const
    );

    expect(plan).toEqual({
      primarySkillId: "ExplainSkill",
      secondarySkillIds: ["CallFlowSkill", "PrincipleSkill"],
      reason: "Need behavior explanation with upstream context."
    });
  });

  it("accepts planner output with more than two secondary skills", () => {
    const plan = normalizeSkillSelectionPlan(
      {
        primarySkillId: "ExplainSkill",
        secondarySkillIds: ["CallFlowSkill", "PrincipleSkill", "RiskReviewSkill"],
        reason: "Need broad reasoning coverage."
      },
      ["ExplainSkill", "CallFlowSkill", "PrincipleSkill", "RiskReviewSkill"] as const
    );

    expect(plan).toEqual({
      primarySkillId: "ExplainSkill",
      secondarySkillIds: ["CallFlowSkill", "PrincipleSkill", "RiskReviewSkill"],
      reason: "Need broad reasoning coverage."
    });
  });

  it("rejects planner output when primary skill is unknown", () => {
    const plan = normalizeSkillSelectionPlan(
      {
        primarySkillId: "UnknownSkill",
        secondarySkillIds: [],
        reason: "unknown"
      },
      ["ExplainSkill", "CallFlowSkill"] as const
    );

    expect(plan).toBeNull();
  });

  it("rejects planner output when secondary has duplicates", () => {
    const duplicateSecondary = normalizeSkillSelectionPlan(
      {
        primarySkillId: "ExplainSkill",
        secondarySkillIds: ["CallFlowSkill", "CallFlowSkill"],
        reason: "dup"
      },
      ["ExplainSkill", "CallFlowSkill", "PrincipleSkill", "RiskReviewSkill"] as const
    );

    expect(duplicateSecondary).toBeNull();
  });

  it("returns null for non-json planner responses", () => {
    const parsed = parseSkillSelectionResponse(
      "not a json payload",
      ["ExplainSkill", "CallFlowSkill"] as const
    );

    expect(parsed).toBeNull();
  });

  it("falls back to null when model returns invalid planner payload", async () => {
    const adapter = new StubAdapter('{"primarySkillId":"ExplainSkill","secondarySkillIds":["ExplainSkill"],"reason":"dup"}');

    const plan = await planSkillSelection({
      kind: "ask",
      modelConfig: MODEL_CONFIG,
      objective: "Explain this function behavior.",
      contextSummary: "activeFile=src/auth.ts",
      candidates: [
        {
          id: "ExplainSkill",
          displayName: "Explain Code",
          description: "Explain code behavior.",
          focus: "runtime behavior",
          source: "fallback-default"
        },
        {
          id: "CallFlowSkill",
          displayName: "Call Flow",
          description: "Analyze callers and callees.",
          focus: "upstream/downstream",
          source: "fallback-default"
        }
      ],
      adapter
    });

    expect(plan).toBeNull();
  });

  it("returns normalized plan when model response is valid json", async () => {
    const expected: SkillSelectionPlan<"MissionSkill" | "BootstrapTraceSkill"> = {
      primarySkillId: "MissionSkill",
      secondarySkillIds: ["BootstrapTraceSkill"],
      reason: "Mission first, then startup grounding."
    };
    const adapter = new StubAdapter(JSON.stringify(expected));

    const plan = await planSkillSelection({
      kind: "overview",
      modelConfig: MODEL_CONFIG,
      objective: "Build project overview json.",
      contextSummary: "entryCandidates=src/index.ts",
      candidates: [
        {
          id: "MissionSkill",
          displayName: "Mission",
          description: "Repository mission",
          focus: "project goal",
          source: "fallback-default"
        },
        {
          id: "BootstrapTraceSkill",
          displayName: "Bootstrap",
          description: "Trace startup",
          focus: "startup path",
          source: "fallback-default"
        }
      ],
      adapter
    });

    expect(plan).toEqual(expected);
  });

  it("uses base ask skills only when no section keywords are matched", async () => {
    const adapter = new StubAdapter(
      JSON.stringify({
        primarySkillId: "ExplainSkill",
        secondarySkillIds: [],
        reason: "base only"
      })
    );

    await planAskSkillSelection(
      {
        modelConfig: MODEL_CONFIG,
        workspaceRoot: process.cwd(),
        question: "解释这个函数在做什么",
        contextSummary: "activeFile=src/auth.ts"
      },
      { adapter }
    );

    const prompt = adapter.lastRequest?.messages[1]?.content ?? "";
    expect(prompt).toContain("id=ExplainSkill");
    expect(prompt).toContain("id=ModuleSummarySkill");
    expect(prompt).not.toContain("id=SimplifiedPseudocodeSkill");
    expect(prompt).not.toContain("id=InputOutputSkill");
  });

  it("derives section secondary skills from user input while primary stays in base skill pool", async () => {
    const adapter = new StubAdapter(
      JSON.stringify({
        primarySkillId: "CallFlowSkill",
        secondarySkillIds: [],
        reason: "base call-flow intent"
      })
    );

    const plan = await planAskSkillSelection(
      {
        modelConfig: MODEL_CONFIG,
        workspaceRoot: process.cwd(),
        question: "请给我伪代码并说明输入输出",
        contextSummary: "activeFile=src/auth.ts"
      },
      { adapter }
    );

    const prompt = adapter.lastRequest?.messages[1]?.content ?? "";
    expect(prompt).toContain("id=ExplainSkill");
    expect(prompt).toContain("id=CallFlowSkill");
    expect(prompt).not.toContain("id=SimplifiedPseudocodeSkill");
    expect(prompt).not.toContain("id=InputOutputSkill");
    expect(plan?.primarySkillId).toBe("CallFlowSkill");
    expect(plan?.secondarySkillIds).toEqual(["InputOutputSkill", "SimplifiedPseudocodeSkill"]);
  });

  it("does not cap ask secondary skills when question hits multiple section intents", async () => {
    const adapter = new StubAdapter(
      JSON.stringify({
        primarySkillId: "ExplainSkill",
        secondarySkillIds: [],
        reason: "base explain intent"
      })
    );

    const plan = await planAskSkillSelection(
      {
        modelConfig: MODEL_CONFIG,
        workspaceRoot: process.cwd(),
        question: "请说明输入输出，给出伪代码，分析性能，并发状态，测试建议和重构建议",
        contextSummary: "activeFile=src/auth.ts"
      },
      { adapter }
    );

    expect(plan?.primarySkillId).toBe("ExplainSkill");
    expect(plan?.secondarySkillIds).toEqual([
      "InputOutputSkill",
      "SimplifiedPseudocodeSkill",
      "PerformanceConsiderationsSkill",
      "ConcurrencyStateSkill",
      "TestingNotesSkill",
      "RefactorSuggestionsSkill"
    ]);
  });
});

class StubAdapter implements ModelAdapter {
  lastRequest: ModelRequest | null = null;

  constructor(private readonly content: string) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "test-model", label: "test-model" }];
  }

  async *streamChat(_request: ModelRequest): AsyncIterable<{ delta: string; done?: boolean }> {
    yield { delta: this.content };
    yield { delta: "", done: true };
  }

  async completeChat(_request: ModelRequest): Promise<ModelResponse> {
    this.lastRequest = _request;
    return { content: this.content };
  }

  supportsVision(): boolean {
    return false;
  }

  supportsToolCalling(): boolean {
    return false;
  }

  supportsReasoning(): boolean {
    return true;
  }
}
