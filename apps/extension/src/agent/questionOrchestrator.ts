import type {
  EditorSelectionState,
  EvidenceSpan,
  QuestionContext,
  StructuredThreadAnswer,
  ThreadQuestionType
} from "@code-vibe/shared";

import { classifyQuestionType } from "./questionClassifier";
import {
  detectSectionTitlesFromQuestion,
  isSectionSkillId,
  prioritizeEvidenceForSkill,
  requiredSectionTitlesFromSkillIds,
  resolveAgentSkill,
  resolveAgentSkillById,
} from "./skills";
import { AGENT_SOUL_SYSTEM_PROMPT } from "./soul";

export interface QuestionOrchestratorInput {
  question: string;
  editorState: EditorSelectionState;
  context: QuestionContext;
  evidence: EvidenceSpan[];
  workspaceRoot: string;
  forcedQuestionType?: ThreadQuestionType;
  learnedSkillInstructions?: string[];
  selectedSkillIds?: StructuredThreadAnswer["skillId"][];
  selectionReason?: string;
}

export interface QuestionOrchestratorOutput {
  questionType: ThreadQuestionType;
  skillId: StructuredThreadAnswer["skillId"];
  systemInstruction: string;
  promptInstruction: string;
  prioritizedEvidence: EvidenceSpan[];
  requestedSections: string[];
  focusMode: "full" | "focused";
  summaryMode: boolean;
}

export function orchestrateQuestion(input: QuestionOrchestratorInput): QuestionOrchestratorOutput {
  const fallbackQuestionType =
    input.forcedQuestionType ?? classifyQuestionType(input.question, input.workspaceRoot);
  const selectedSkillIds = normalizeSelectedSkillIds(input.selectedSkillIds);
  const skills =
    selectedSkillIds.length > 0
      ? selectedSkillIds.map((skillId) => resolveAgentSkillById(skillId, input.workspaceRoot))
      : [resolveAgentSkill(fallbackQuestionType, input.workspaceRoot)];
  const primarySkill = skills[0];
  const secondarySkills = skills.slice(1);
  const questionType = primarySkill.questionType;
  const requestedSections = detectRequestedSections(input.question, selectedSkillIds);
  const hasSelectedSectionSkill = selectedSkillIds.some((skillId) => isSectionSkillId(skillId));
  const focusMode = shouldUseFocusedMode(input.question, primarySkill.id, hasSelectedSectionSkill)
    ? "focused"
    : "full";
  const summaryMode = shouldUseSummaryMode(input.question, questionType);
  const learnedSkills = focusMode === "focused" ? [] : (input.learnedSkillInstructions ?? []);
  const skillInstructionSection = skills
    .map((skill, index) =>
      [
        `${index + 1}. ${skill.id}`,
        `Description: ${skill.skillDocDescription}`,
        `Focus: ${skill.focus}`,
        `Source: ${skill.skillDocPath ?? "fallback-default"}`,
        skill.skillDocBody
      ].join("\n")
    )
    .join("\n\n");

  const systemInstruction = [
    AGENT_SOUL_SYSTEM_PROMPT,
    `Primary skill: ${primarySkill.id}.`,
    secondarySkills.length > 0
      ? `Secondary skills: ${secondarySkills.map((skill) => skill.id).join(", ")}.`
      : "Secondary skills: none.",
    `Skill selection reason: ${input.selectionReason?.trim() || "not provided"}.`,
    `Primary skill description: ${primarySkill.skillDocDescription}`,
    `Primary skill focus: ${primarySkill.focus}`,
    primarySkill.skillDocPath
      ? `Skill document path: ${primarySkill.skillDocPath}`
      : "Skill document path: fallback-default",
    learnedSkills.length > 0
      ? `Apply learned style skills: ${learnedSkills.join(" ")}`
      : "Apply default style skills."
  ].join(" ");
  const schemaLines = summaryMode
    ? [
        "{",
        '  "questionRestatement": "string",',
        '  "conclusion": "string",',
        '  "sections": [{"title":"string","content":"string"}],',
        '  "extraSections": [{"title":"string","content":"string"}]',
        "}"
      ]
    : [
        "{",
        '  "sections": [{"title":"string","content":"string"}],',
        '  "questionRestatement": "string (optional, can be empty)",',
        '  "conclusion": "string (optional, can be empty)",',
        '  "extraSections": [{"title":"string","content":"string"}]',
        "}"
      ];
  const promptInstruction = [
    "Respond with a strict JSON object only. Do not include markdown fences.",
    "JSON schema:",
    ...schemaLines,
    "The `sections` array is primary. Include only sections directly useful for the user question (usually 2-4 sections).",
    "Avoid generic headings unless user asked for broad explanation.",
    "Write each field with concrete, evidence-grounded statements.",
    `Question type: ${questionType}.`,
    `Active skill bundle: ${skills.map((skill) => skill.id).join(", ")}.`,
    `Selection range: ${input.editorState.activeFile}:${input.editorState.startLine}-${input.editorState.endLine}.`,
    `Active symbol: ${input.context.activeSymbolId ?? "unknown"}.`,
    `Evidence strategy (primary skill): ${primarySkill.evidenceHint}`,
    secondarySkills.length > 0
      ? `Evidence strategy (secondary skills): ${secondarySkills.map((skill) => skill.evidenceHint).join(" | ")}`
      : "Evidence strategy (secondary skills): none.",
    `Output style (primary skill): ${primarySkill.outputHint}`,
    secondarySkills.length > 0
      ? `Output style (secondary skills): ${secondarySkills.map((skill) => skill.outputHint).join(" | ")}`
      : "Output style (secondary skills): none.",
    "Authoritative skill instructions (from SKILL.md body):",
    skillInstructionSection,
    learnedSkills.length > 0
      ? `Learned skills:\n${learnedSkills.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "Learned skills: none yet.",
    focusMode === "focused"
      ? "Focused mode: prioritize only sections directly requested by user. Non-relevant base sections can be empty strings."
      : "Full mode: provide complete analysis across all base sections.",
    summaryMode
      ? "Summary mode: include concise question restatement + conclusion."
      : "Normal mode: keep questionRestatement/conclusion empty unless user explicitly asks for summary."
  ].join("\n");
  const dynamicPrompt = requestedSections.length > 0
    ? [
        "User-requested sections (required):",
        ...requestedSections.map((item, index) => `${index + 1}. ${item}`),
        "You MUST include each requested title exactly in the `sections` array with non-empty content.",
        "Section title policy: `sections.title` must be exactly one of the requested titles listed above.",
        "If a skill suggests sub-headings (for example Call Flow / Upstream / Downstream / Impact Analysis or Inputs / Outputs), keep those as structured bullets inside `content`, not as additional section titles.",
        "Do not move requested titles into `extraSections`."
      ].join("\n")
    : "No extra sections requested by user.";
  const strictFocusPrompt =
    focusMode === "focused" && requestedSections.length > 0
      ? `Focused strictness: sections MUST stay within requested section titles only: ${requestedSections.join(", ")}.`
      : "Focused strictness: not applied.";

  return {
    questionType,
    skillId: primarySkill.id,
    systemInstruction,
    promptInstruction: `${promptInstruction}\n${dynamicPrompt}\n${strictFocusPrompt}`,
    prioritizedEvidence: prioritizeEvidenceForSkill(input.evidence, questionType),
    requestedSections,
    focusMode,
    summaryMode
  };
}

function normalizeSelectedSkillIds(
  skillIds: StructuredThreadAnswer["skillId"][] | undefined
): StructuredThreadAnswer["skillId"][] {
  if (!skillIds || skillIds.length === 0) {
    return [];
  }

  const deduped: StructuredThreadAnswer["skillId"][] = [];
  for (const skillId of skillIds) {
    if (deduped.includes(skillId)) {
      continue;
    }
    deduped.push(skillId);
  }

  return deduped;
}

function detectRequestedSections(question: string, selectedSkillIds: StructuredThreadAnswer["skillId"][]): string[] {
  const fromSelectedSkills = requiredSectionTitlesFromSkillIds(selectedSkillIds);
  const fromKeywords = detectSectionTitlesFromQuestion(question);
  const sections: string[] = [];

  for (const title of [...fromSelectedSkills, ...fromKeywords]) {
    if (sections.includes(title)) {
      continue;
    }
    sections.push(title);
  }

  if (/(call flow|caller|callee|调用链|谁调用|上下游|upstream|downstream)/i.test(question.toLowerCase())) {
    const callFlowTitle = "Call flow / upstream-downstream";
    if (!sections.includes(callFlowTitle)) {
      sections.push(callFlowTitle);
    }
  }

  return sections;
}

function shouldUseFocusedMode(
  question: string,
  primarySkillId: StructuredThreadAnswer["skillId"],
  hasSelectedSectionSkill: boolean
): boolean {
  return (
    hasSelectedSectionSkill ||
    isSectionSkillId(primarySkillId) ||
    /(pseudocode|pseudo-code|伪代码|流程代码|简化代码|只要|just|only|只需要|仅需)/i.test(question.toLowerCase())
  );
}

function shouldUseSummaryMode(question: string, questionType: ThreadQuestionType): boolean {
  if (questionType === "module_summary") {
    return true;
  }
  return /(总结|归纳|summary|summarize|tl;dr|tldr)/i.test(question.toLowerCase());
}
