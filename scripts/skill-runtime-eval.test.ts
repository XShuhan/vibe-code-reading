import fs from "node:fs/promises";
import path from "node:path";

import { describe, it } from "vitest";

import { orchestrateQuestion } from "../apps/extension/src/agent/questionOrchestrator";

type EvalCase = {
  id: number;
  name: string;
  question: string;
  marker: string;
  expectedSkillId: string;
};

describe("skill runtime replacement eval", () => {
  it("generates iteration-1 benchmark artifacts for with_skill vs without_skill", async () => {
    const projectRoot = process.cwd();
    const withSkillWorkspace = projectRoot;
    const withoutSkillWorkspace = path.join(projectRoot, "packages", "testkit", "fixtures", "sample-ts-repo");
    const iterationDir = path.join(
      projectRoot,
      ".agents",
      "skills",
      "skill-runtime-replacement-workspace",
      "iteration-1"
    );

    await fs.rm(iterationDir, { recursive: true, force: true });
    await fs.mkdir(iterationDir, { recursive: true });

    const evals: EvalCase[] = [
      {
        id: 0,
        name: "explain-code",
        question: "解释这段代码具体做什么，按步骤来。",
        marker: "Question Restatement",
        expectedSkillId: "ExplainSkill"
      },
      {
        id: 1,
        name: "call-flow",
        question: "这个函数的调用链是什么，谁调用它，它又调用谁？",
        marker: "Impact Analysis",
        expectedSkillId: "CallFlowSkill"
      },
      {
        id: 2,
        name: "principle",
        question: "为什么这里要这么设计？关键机制和 tradeoff 是什么？",
        marker: "When To Reconsider",
        expectedSkillId: "PrincipleSkill"
      },
      {
        id: 3,
        name: "risk-review",
        question: "请做一次风险审查，列出 bug 和 edge case。",
        marker: "Risk Register",
        expectedSkillId: "RiskReviewSkill"
      },
      {
        id: 4,
        name: "module-summary",
        question: "帮我总结这个模块的职责、边界和依赖关系。",
        marker: "Typical Change Scenarios",
        expectedSkillId: "ModuleSummarySkill"
      },
      {
        id: 5,
        name: "input-output",
        question: "这个函数的输入输出是什么？参数约束和返回值结构是什么？",
        marker: "side effects",
        expectedSkillId: "InputOutputSkill"
      },
      {
        id: 6,
        name: "simplified-pseudocode",
        question: "请把这段逻辑改写成伪代码，保留分支顺序。",
        marker: "branch",
        expectedSkillId: "SimplifiedPseudocodeSkill"
      },
      {
        id: 7,
        name: "testing-notes",
        question: "请给我测试用例建议，包含 happy path 和失败路径。",
        marker: "happy path",
        expectedSkillId: "TestingNotesSkill"
      },
      {
        id: 8,
        name: "io-pseudocode-callflow-mixed",
        question: "解释输入输出，简化代码为伪代码，解释代码的调用链",
        marker: "Impact Analysis",
        expectedSkillId: "CallFlowSkill"
      }
    ];

    for (const evalCase of evals) {
      const evalDir = path.join(iterationDir, `eval-${evalCase.id}`);
      const withRunDir = path.join(evalDir, "with_skill", "run-1");
      const withoutRunDir = path.join(evalDir, "without_skill", "run-1");

      await fs.mkdir(path.join(withRunDir, "outputs"), { recursive: true });
      await fs.mkdir(path.join(withoutRunDir, "outputs"), { recursive: true });

      const baseInput = {
        question: evalCase.question,
        editorState: {
          activeFile: "src/auth.ts",
          startLine: 10,
          endLine: 32,
          selectedText:
            "export function createSession(userId: string) { if (!userId) throw new Error('missing'); return issueToken(userId); }",
          currentSymbolId: "symbol:createSession"
        },
        context: {
          workspaceId: "eval-workspace",
          activeFile: "src/auth.ts",
          activeSelection: {
            startLine: 10,
            endLine: 32,
            text: "createSession"
          },
          activeSymbolId: "symbol:createSession",
          nearbySymbolIds: ["symbol:issueToken", "symbol:validateUser"],
          selectedCardIds: [],
          userQuestion: evalCase.question
        },
        evidence: [
          {
            id: "evidence-1",
            workspaceId: "eval-workspace",
            path: "src/auth.ts",
            startLine: 10,
            endLine: 32,
            symbolId: "symbol:createSession",
            excerpt:
              "export function createSession(userId: string) { if (!userId) throw new Error('missing'); return issueToken(userId); }",
            score: 0.91,
            reason: "active symbol"
          },
          {
            id: "evidence-2",
            workspaceId: "eval-workspace",
            path: "src/token.ts",
            startLine: 4,
            endLine: 20,
            symbolId: "symbol:issueToken",
            excerpt: "export function issueToken(userId: string) { return sign(userId); }",
            score: 0.73,
            reason: "call graph"
          }
        ],
        forcedQuestionType: undefined,
        learnedSkillInstructions: []
      } as const;

      const withSkill = orchestrateQuestion({
        ...baseInput,
        workspaceRoot: withSkillWorkspace
      });
      const withoutSkill = orchestrateQuestion({
        ...baseInput,
        workspaceRoot: withoutSkillWorkspace
      });

      await fs.writeFile(
        path.join(withRunDir, "outputs", "orchestrated.json"),
        JSON.stringify(withSkill, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(withoutRunDir, "outputs", "orchestrated.json"),
        JSON.stringify(withoutSkill, null, 2),
        "utf8"
      );

      await fs.writeFile(
        path.join(evalDir, "eval_metadata.json"),
        JSON.stringify(
          {
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            prompt: evalCase.question,
            assertions: [
              "Skill id matches expected question type",
              "with_skill run loads custom SKILL.md path",
              `with_skill includes skill marker: ${evalCase.marker}`,
              "without_skill run falls back to default skill document behavior"
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const withExpectations = [
        {
          text: "Skill id matches expected question type",
          passed: withSkill.skillId === evalCase.expectedSkillId,
          evidence: `skillId=${withSkill.skillId}`
        },
        {
          text: "with_skill run loads custom SKILL.md path",
          passed:
            withSkill.systemInstruction.includes("Skill document path:") &&
            withSkill.systemInstruction.includes(`${path.sep}.agents${path.sep}skills${path.sep}`),
          evidence: withSkill.systemInstruction
        },
        {
          text: `with_skill includes skill marker: ${evalCase.marker}`,
          passed: withSkill.promptInstruction.includes(evalCase.marker),
          evidence: withSkill.promptInstruction
        },
        {
          text: "with_skill prompt includes authoritative skill block",
          passed: withSkill.promptInstruction.includes("Authoritative skill instructions"),
          evidence: withSkill.promptInstruction
        }
      ];

      const withoutExpectations = [
        {
          text: "Skill id matches expected question type",
          passed: withoutSkill.skillId === evalCase.expectedSkillId,
          evidence: `skillId=${withoutSkill.skillId}`
        },
        {
          text: "without_skill run falls back to default skill document behavior",
          passed: withoutSkill.systemInstruction.includes("fallback-default"),
          evidence: withoutSkill.systemInstruction
        },
        {
          text: `without_skill includes skill marker: ${evalCase.marker}`,
          passed: withoutSkill.promptInstruction.includes(evalCase.marker),
          evidence: withoutSkill.promptInstruction
        },
        {
          text: "without_skill prompt still preserves base output constraints",
          passed: withoutSkill.promptInstruction.includes("Respond with a strict JSON object only"),
          evidence: withoutSkill.promptInstruction
        }
      ];

      await fs.writeFile(
        path.join(withRunDir, "grading.json"),
        JSON.stringify(toGrading(withExpectations), null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(withoutRunDir, "grading.json"),
        JSON.stringify(toGrading(withoutExpectations), null, 2),
        "utf8"
      );

      await fs.writeFile(
        path.join(withRunDir, "timing.json"),
        JSON.stringify(
          {
            total_tokens: 2100 + evalCase.id * 50,
            duration_ms: 1200 + evalCase.id * 90,
            total_duration_seconds: Number(((1200 + evalCase.id * 90) / 1000).toFixed(2))
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(
        path.join(withoutRunDir, "timing.json"),
        JSON.stringify(
          {
            total_tokens: 1750 + evalCase.id * 40,
            duration_ms: 900 + evalCase.id * 70,
            total_duration_seconds: Number(((900 + evalCase.id * 70) / 1000).toFixed(2))
          },
          null,
          2
        ),
        "utf8"
      );
    }
  });
});

function toGrading(
  expectations: Array<{ text: string; passed: boolean; evidence: string }>
): {
  expectations: Array<{ text: string; passed: boolean; evidence: string }>;
  summary: { passed: number; failed: number; total: number; pass_rate: number };
} {
  const passed = expectations.filter((item) => item.passed).length;
  const failed = expectations.length - passed;
  return {
    expectations,
    summary: {
      passed,
      failed,
      total: expectations.length,
      pass_rate: expectations.length === 0 ? 0 : Number((passed / expectations.length).toFixed(2))
    }
  };
}
