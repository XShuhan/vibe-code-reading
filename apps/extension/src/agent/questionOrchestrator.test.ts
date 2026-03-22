import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { orchestrateQuestion } from "./questionOrchestrator";

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map(async (targetPath) => {
      await fs.rm(targetPath, { recursive: true, force: true });
    })
  );
});

describe("questionOrchestrator skill bundle", () => {
  it("injects only the selected primary skill when one skill id is provided", async () => {
    const workspaceRoot = await createAskSkillWorkspace({
      "call-flow-skill": "CALL_FLOW_MARKER",
      "explain-skill": "EXPLAIN_MARKER"
    });

    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot,
      forcedQuestionType: "explain_code",
      selectedSkillIds: ["CallFlowSkill"],
      selectionReason: "Need call graph focus."
    });

    expect(output.questionType).toBe("call_flow");
    expect(output.skillId).toBe("CallFlowSkill");
    expect(output.promptInstruction).toContain("CALL_FLOW_MARKER");
    expect(output.promptInstruction).not.toContain("EXPLAIN_MARKER");
    expect(output.systemInstruction).toContain("Skill selection reason: Need call graph focus.");
  });

  it("injects primary and all provided secondary skills in order", async () => {
    const workspaceRoot = await createAskSkillWorkspace({
      "explain-skill": "EXPLAIN_MARKER",
      "risk-review-skill": "RISK_MARKER",
      "input-output-skill": "IO_MARKER",
      "simplified-pseudocode-skill": "PSEUDO_MARKER",
      "testing-notes-skill": "TEST_MARKER"
    });

    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot,
      selectedSkillIds: [
        "ExplainSkill",
        "RiskReviewSkill",
        "InputOutputSkill",
        "SimplifiedPseudocodeSkill",
        "TestingNotesSkill"
      ],
      selectionReason: "Behavior first then risk validation."
    });

    const explainIndex = output.promptInstruction.indexOf("1. ExplainSkill");
    const riskIndex = output.promptInstruction.indexOf("2. RiskReviewSkill");
    const ioIndex = output.promptInstruction.indexOf("3. InputOutputSkill");
    const pseudoIndex = output.promptInstruction.indexOf("4. SimplifiedPseudocodeSkill");
    const testIndex = output.promptInstruction.indexOf("5. TestingNotesSkill");

    expect(output.questionType).toBe("explain_code");
    expect(output.skillId).toBe("ExplainSkill");
    expect(output.promptInstruction).toContain("EXPLAIN_MARKER");
    expect(output.promptInstruction).toContain("RISK_MARKER");
    expect(output.promptInstruction).toContain("IO_MARKER");
    expect(output.promptInstruction).toContain("PSEUDO_MARKER");
    expect(output.promptInstruction).toContain("TEST_MARKER");
    expect(explainIndex).toBeGreaterThan(-1);
    expect(riskIndex).toBeGreaterThan(explainIndex);
    expect(ioIndex).toBeGreaterThan(riskIndex);
    expect(pseudoIndex).toBeGreaterThan(ioIndex);
    expect(testIndex).toBeGreaterThan(pseudoIndex);
  });

  it("falls back to classifier/forced type behavior when no selected skills are given", () => {
    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot: "E:/workspace-without-custom-skills",
      forcedQuestionType: "principle"
    });

    expect(output.questionType).toBe("principle");
    expect(output.skillId).toBe("PrincipleSkill");
    expect(output.systemInstruction).toContain("Skill document path: fallback-default");
    expect(output.promptInstruction).toContain("Respond with a strict JSON object only.");
  });

  it("uses section skill as primary and forces focused mode with mapped requested section", async () => {
    const workspaceRoot = await createAskSkillWorkspace({
      "simplified-pseudocode-skill": "PSEUDOCODE_MARKER"
    });

    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot,
      selectedSkillIds: ["SimplifiedPseudocodeSkill"],
      selectionReason: "Need pseudocode only"
    });

    expect(output.questionType).toBe("simplified_pseudocode");
    expect(output.skillId).toBe("SimplifiedPseudocodeSkill");
    expect(output.focusMode).toBe("focused");
    expect(output.requestedSections).toEqual(["Simplified Pseudocode"]);
    expect(output.promptInstruction).toContain("PSEUDOCODE_MARKER");
    expect(output.promptInstruction).toContain("User-requested sections (required):");
  });

  it("falls back to keyword section detection when no section skill is selected", () => {
    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot: "E:/workspace-without-custom-skills",
      question: "请给出输入输出和测试用例建议",
      forcedQuestionType: "explain_code"
    });

    expect(output.requestedSections).toEqual(["Input / Output", "Testing Notes"]);
  });

  it("keeps call-flow section when question asks io + pseudocode + call chain together", async () => {
    const workspaceRoot = await createAskSkillWorkspace({
      "call-flow-skill": "CALL_FLOW_MARKER",
      "input-output-skill": "IO_MARKER",
      "simplified-pseudocode-skill": "PSEUDOCODE_MARKER"
    });

    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot,
      question: "解释输入输出，简化代码为伪代码，解释代码的调用链",
      selectedSkillIds: ["CallFlowSkill", "InputOutputSkill", "SimplifiedPseudocodeSkill"],
      selectionReason: "Need call flow + io + pseudocode."
    });

    expect(output.questionType).toBe("call_flow");
    expect(output.skillId).toBe("CallFlowSkill");
    expect(output.focusMode).toBe("focused");
    expect(output.requestedSections).toEqual([
      "Call flow / upstream-downstream",
      "Input / Output",
      "Simplified Pseudocode"
    ]);
    expect(output.promptInstruction).toContain("Focused strictness: sections MUST stay within requested section titles only");
  });

  it("keeps module responsibility section when question asks call chain + module responsibility + pseudocode", async () => {
    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot: "E:/workspace-without-custom-skills",
      question: "追踪调用链，模块职责是什么，简化代码",
      selectedSkillIds: ["ModuleSummarySkill", "SimplifiedPseudocodeSkill"],
      selectionReason: "module primary + pseudocode section"
    });

    expect(output.questionType).toBe("module_summary");
    expect(output.skillId).toBe("ModuleSummarySkill");
    expect(output.focusMode).toBe("focused");
    expect(output.requestedSections).toEqual([
      "Module Responsibilities",
      "Simplified Pseudocode",
      "Call flow / upstream-downstream"
    ]);
  });

  it("keeps explain section when question asks explain + call chain + pseudocode", async () => {
    const output = orchestrateQuestion({
      ...makeInput(),
      workspaceRoot: "E:/workspace-without-custom-skills",
      question: "解释这段代码的作用，追踪调用链，简化代码",
      selectedSkillIds: ["ExplainSkill", "SimplifiedPseudocodeSkill"],
      selectionReason: "explain primary + pseudocode section"
    });

    expect(output.questionType).toBe("explain_code");
    expect(output.skillId).toBe("ExplainSkill");
    expect(output.focusMode).toBe("focused");
    expect(output.requestedSections).toEqual([
      "Code Behavior",
      "Simplified Pseudocode",
      "Call flow / upstream-downstream"
    ]);
  });
});

function makeInput() {
  return {
    question: "请解释这个函数并说明调用关系",
    editorState: {
      activeFile: "src/auth.ts",
      startLine: 10,
      endLine: 36,
      selectedText: "function createSession(userId: string) { return issueToken(userId); }",
      currentSymbolId: "symbol:createSession"
    },
    context: {
      workspaceId: "workspace_1",
      activeFile: "src/auth.ts",
      activeSelection: {
        startLine: 10,
        endLine: 36,
        text: "createSession"
      },
      activeSymbolId: "symbol:createSession",
      nearbySymbolIds: ["symbol:issueToken"],
      selectedCardIds: [],
      userQuestion: "请解释这个函数并说明调用关系"
    },
    evidence: [
      {
        id: "e1",
        workspaceId: "workspace_1",
        path: "src/auth.ts",
        startLine: 10,
        endLine: 36,
        symbolId: "symbol:createSession",
        excerpt: "function createSession(userId: string) { return issueToken(userId); }",
        score: 0.91,
        reason: "active symbol"
      }
    ]
  };
}

async function createAskSkillWorkspace(markers: Record<string, string>): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ask-skill-workspace-"));
  createdPaths.push(workspaceRoot);

  for (const [folder, marker] of Object.entries(markers)) {
    const skillDir = path.join(workspaceRoot, ".agents", "skills", folder);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        `name: ${folder}`,
        `description: ${folder} description marker`,
        "---",
        "",
        `# ${folder}`,
        "",
        "## Core goals",
        "",
        "1. test focus marker",
        "",
        "## Workflow",
        "",
        marker
      ].join("\n"),
      "utf8"
    );
  }

  return workspaceRoot;
}
