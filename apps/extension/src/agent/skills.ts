import fs from "node:fs";
import path from "node:path";

import type { EvidenceSpan, ThreadQuestionType, ThreadSkillId } from "@code-vibe/shared";

type AskBaseQuestionType =
  | "explain_code"
  | "call_flow"
  | "principle"
  | "risk_review"
  | "module_summary";

type AskSectionQuestionType =
  | "input_output"
  | "simplified_pseudocode"
  | "performance_considerations"
  | "concurrency_state"
  | "testing_notes"
  | "refactor_suggestions";

type AskSectionSkillId =
  | "InputOutputSkill"
  | "SimplifiedPseudocodeSkill"
  | "PerformanceConsiderationsSkill"
  | "ConcurrencyStateSkill"
  | "TestingNotesSkill"
  | "RefactorSuggestionsSkill";

type AskSectionSkillRule = {
  questionType: AskSectionQuestionType;
  skillId: AskSectionSkillId;
  sectionTitle: string;
  keywordPattern: RegExp;
};

export interface AgentSkillDefinition {
  id: ThreadSkillId;
  questionType: ThreadQuestionType;
  displayName: string;
  focus: string;
  evidenceHint: string;
  outputHint: string;
  skillDocDescription: string;
  skillDocBody: string;
  skillDocPath?: string;
}

type SkillDocMapping = {
  folder: string;
  id: ThreadSkillId;
  displayName: string;
};

export const ASK_BASE_QUESTION_TYPES: readonly AskBaseQuestionType[] = [
  "explain_code",
  "call_flow",
  "principle",
  "risk_review",
  "module_summary"
];

export const ASK_SECTION_SKILL_RULES: readonly AskSectionSkillRule[] = [
  {
    questionType: "input_output",
    skillId: "InputOutputSkill",
    sectionTitle: "Input / Output",
    keywordPattern: /(input|output|i\/o|io|输入|输出|入参|返回值|参数)/i
  },
  {
    questionType: "simplified_pseudocode",
    skillId: "SimplifiedPseudocodeSkill",
    sectionTitle: "Simplified Pseudocode",
    keywordPattern: /(pseudocode|pseudo-code|伪代码|流程代码|简化代码)/i
  },
  {
    questionType: "performance_considerations",
    skillId: "PerformanceConsiderationsSkill",
    sectionTitle: "Performance Considerations",
    keywordPattern: /(performance|复杂度|性能|效率|耗时|memory|内存)/i
  },
  {
    questionType: "concurrency_state",
    skillId: "ConcurrencyStateSkill",
    sectionTitle: "Concurrency / State",
    keywordPattern: /(并发|线程|锁|async|await|race|竞态)/i
  },
  {
    questionType: "testing_notes",
    skillId: "TestingNotesSkill",
    sectionTitle: "Testing Notes",
    keywordPattern: /(test|测试|用例|mock|验证)/i
  },
  {
    questionType: "refactor_suggestions",
    skillId: "RefactorSuggestionsSkill",
    sectionTitle: "Refactor Suggestions",
    keywordPattern: /(refactor|重构|改进|优化建议)/i
  }
];

export const ASK_SECTION_QUESTION_TYPES: readonly AskSectionQuestionType[] = ASK_SECTION_SKILL_RULES.map(
  (rule) => rule.questionType
);

export const ASK_SKILL_QUESTION_TYPES: readonly ThreadQuestionType[] = [
  ...ASK_BASE_QUESTION_TYPES,
  ...ASK_SECTION_QUESTION_TYPES
];

const QUESTION_TYPE_BY_SKILL_ID: Record<ThreadSkillId, ThreadQuestionType> = {
  ExplainSkill: "explain_code",
  CallFlowSkill: "call_flow",
  PrincipleSkill: "principle",
  RiskReviewSkill: "risk_review",
  ModuleSummarySkill: "module_summary",
  InputOutputSkill: "input_output",
  SimplifiedPseudocodeSkill: "simplified_pseudocode",
  PerformanceConsiderationsSkill: "performance_considerations",
  ConcurrencyStateSkill: "concurrency_state",
  TestingNotesSkill: "testing_notes",
  RefactorSuggestionsSkill: "refactor_suggestions"
};

const SECTION_TITLE_BY_SKILL_ID = new Map<ThreadSkillId, string>(
  ASK_SECTION_SKILL_RULES.map((rule) => [rule.skillId, rule.sectionTitle])
);

const REQUIRED_SECTION_TITLE_BY_SKILL_ID: Record<ThreadSkillId, string> = {
  ExplainSkill: "Code Behavior",
  CallFlowSkill: "Call flow / upstream-downstream",
  PrincipleSkill: "Mechanism",
  RiskReviewSkill: "Risk Register",
  ModuleSummarySkill: "Module Responsibilities",
  InputOutputSkill: "Input / Output",
  SimplifiedPseudocodeSkill: "Simplified Pseudocode",
  PerformanceConsiderationsSkill: "Performance Considerations",
  ConcurrencyStateSkill: "Concurrency / State",
  TestingNotesSkill: "Testing Notes",
  RefactorSuggestionsSkill: "Refactor Suggestions"
};

const SKILL_DOC_MAPPINGS: Record<ThreadQuestionType, SkillDocMapping> = {
  explain_code: {
    folder: "explain-skill",
    id: "ExplainSkill",
    displayName: "Explain Code"
  },
  call_flow: {
    folder: "call-flow-skill",
    id: "CallFlowSkill",
    displayName: "Call Flow"
  },
  principle: {
    folder: "principle-skill",
    id: "PrincipleSkill",
    displayName: "Principle"
  },
  risk_review: {
    folder: "risk-review-skill",
    id: "RiskReviewSkill",
    displayName: "Risk Review"
  },
  module_summary: {
    folder: "module-summary-skill",
    id: "ModuleSummarySkill",
    displayName: "Module Summary"
  },
  input_output: {
    folder: "input-output-skill",
    id: "InputOutputSkill",
    displayName: "Input / Output"
  },
  simplified_pseudocode: {
    folder: "simplified-pseudocode-skill",
    id: "SimplifiedPseudocodeSkill",
    displayName: "Simplified Pseudocode"
  },
  performance_considerations: {
    folder: "performance-considerations-skill",
    id: "PerformanceConsiderationsSkill",
    displayName: "Performance Considerations"
  },
  concurrency_state: {
    folder: "concurrency-state-skill",
    id: "ConcurrencyStateSkill",
    displayName: "Concurrency / State"
  },
  testing_notes: {
    folder: "testing-notes-skill",
    id: "TestingNotesSkill",
    displayName: "Testing Notes"
  },
  refactor_suggestions: {
    folder: "refactor-suggestions-skill",
    id: "RefactorSuggestionsSkill",
    displayName: "Refactor Suggestions"
  }
};

const FALLBACK_AGENT_SKILLS: Record<ThreadQuestionType, AgentSkillDefinition> = {
  explain_code: {
    id: "ExplainSkill",
    questionType: "explain_code",
    displayName: "Explain Code",
    focus: "Describe what this code does step by step and what each key branch changes.",
    evidenceHint: "Prioritize active symbol + nearby evidence.",
    outputHint: "Make behavior reconstruction concrete and avoid vague wording.",
    skillDocDescription:
      "Explain selected code behavior step by step with concrete evidence.",
    skillDocBody:
      "Reconstruct runtime behavior in order. Separate facts, inference, and uncertainty. Keep answer concrete and evidence-grounded."
  },
  call_flow: {
    id: "CallFlowSkill",
    questionType: "call_flow",
    displayName: "Call Flow",
    focus: "Explain callers, callees, and data/control handoff points.",
    evidenceHint: "Prioritize evidence with call/import reasons and connected symbols.",
    outputHint: "Explicitly mark upstream and downstream.",
    skillDocDescription:
      "Analyze callers, callees, and upstream/downstream handoff points for selected code.",
    skillDocBody:
      "Map upstream callers, downstream callees, and impact radius. Mark unknown dynamic edges and confidence."
  },
  principle: {
    id: "PrincipleSkill",
    questionType: "principle",
    displayName: "Principle",
    focus: "Explain implementation choices, tradeoffs, and mechanism-level principles.",
    evidenceHint: "Keep algorithmic or policy-oriented evidence first.",
    outputHint: "Use cause-effect language for why this design works.",
    skillDocDescription:
      "Explain implementation principles, tradeoffs, and mechanism-level reasoning behind code decisions.",
    skillDocBody:
      "Explain mechanism before tradeoffs. Compare alternatives and state when to reconsider current design."
  },
  risk_review: {
    id: "RiskReviewSkill",
    questionType: "risk_review",
    displayName: "Risk Review",
    focus: "Identify concrete bugs, edge cases, and maintenance risks.",
    evidenceHint: "Prioritize branching, error handling, and boundary-related evidence.",
    outputHint: "Rank risks by impact and likelihood where possible.",
    skillDocDescription:
      "Identify concrete bugs, edge cases, and maintenance risks, then rank by impact and likelihood.",
    skillDocBody:
      "Use condition -> failure -> impact format. Prioritize by severity and likelihood. Propose targeted mitigations."
  },
  module_summary: {
    id: "ModuleSummarySkill",
    questionType: "module_summary",
    displayName: "Module Summary",
    focus: "Summarize module responsibilities, boundaries, and public surface.",
    evidenceHint: "Prioritize export definitions, interfaces, and related files.",
    outputHint: "Make ownership boundaries and responsibilities explicit.",
    skillDocDescription:
      "Summarize module responsibilities, boundaries, public surface, and dependencies.",
    skillDocBody:
      "Clarify ownership and public APIs first, then internal structure, dependencies, and typical change scenarios."
  },
  input_output: {
    id: "InputOutputSkill",
    questionType: "input_output",
    displayName: "Input / Output",
    focus: "Extract function inputs, outputs, side effects, and data contract assumptions.",
    evidenceHint: "Prioritize function signatures, parameter usage, return values, and IO boundaries.",
    outputHint: "Use concise contract language and show edge-case input handling.",
    skillDocDescription:
      "Explain input/output contracts and side effects for selected code with concrete evidence.",
    skillDocBody:
      "State input requirements, output shape, and side effects. Keep contract statements grounded in code paths and error branches."
  },
  simplified_pseudocode: {
    id: "SimplifiedPseudocodeSkill",
    questionType: "simplified_pseudocode",
    displayName: "Simplified Pseudocode",
    focus: "Translate implementation into concise pseudocode that preserves control flow.",
    evidenceHint: "Prioritize branch conditions, loops, state updates, and return points.",
    outputHint: "Keep pseudocode readable and language-agnostic while preserving key logic.",
    skillDocDescription:
      "Rewrite selected logic into simplified pseudocode with faithful branching and step order.",
    skillDocBody:
      "Output concise pseudocode first, then explain non-obvious branches. Do not drop guard conditions or error paths."
  },
  performance_considerations: {
    id: "PerformanceConsiderationsSkill",
    questionType: "performance_considerations",
    displayName: "Performance Considerations",
    focus: "Analyze performance hotspots, complexity, allocations, and IO bottlenecks.",
    evidenceHint: "Prioritize loops, nested calls, repeated parsing, and expensive external operations.",
    outputHint: "Separate measured facts, inferred risks, and practical optimization options.",
    skillDocDescription:
      "Review complexity and runtime/resource risks, then provide practical optimization guidance.",
    skillDocBody:
      "Highlight dominant cost paths and memory/IO pressure. Explain tradeoffs before suggesting optimizations."
  },
  concurrency_state: {
    id: "ConcurrencyStateSkill",
    questionType: "concurrency_state",
    displayName: "Concurrency / State",
    focus: "Analyze async flow, shared state mutation, ordering guarantees, and race risks.",
    evidenceHint: "Prioritize async/await boundaries, locks, retries, mutable state, and callback ordering.",
    outputHint: "Explain concurrency contracts and failure windows in cause-effect language.",
    skillDocDescription:
      "Explain concurrency and state behavior, including potential race conditions and consistency risks.",
    skillDocBody:
      "Map async boundaries and state transitions. Call out ordering assumptions, missing guards, and race-prone updates."
  },
  testing_notes: {
    id: "TestingNotesSkill",
    questionType: "testing_notes",
    displayName: "Testing Notes",
    focus: "Propose targeted tests for behavior, edge cases, and failure handling.",
    evidenceHint: "Prioritize branches, error paths, boundary parsing, and external dependency seams.",
    outputHint: "Use testable scenarios with clear setup, action, and expected outcome.",
    skillDocDescription:
      "Provide testing scenarios and validation strategy grounded in current logic and risks.",
    skillDocBody:
      "List high-value tests first, covering happy path, edge cases, and failure modes. Suggest mocking boundaries when external dependencies exist."
  },
  refactor_suggestions: {
    id: "RefactorSuggestionsSkill",
    questionType: "refactor_suggestions",
    displayName: "Refactor Suggestions",
    focus: "Provide practical refactor opportunities that improve readability, safety, and maintainability.",
    evidenceHint: "Prioritize duplication, oversized branches, mixed responsibilities, and implicit contracts.",
    outputHint: "Offer incremental refactor steps with expected impact and rollback risk.",
    skillDocDescription:
      "Suggest concrete refactor plans with tradeoffs and safe migration steps.",
    skillDocBody:
      "Identify pain points, propose staged refactors, and explain how behavior is preserved. Avoid large rewrites unless clearly justified."
  }
};

const SKILL_CACHE = new Map<string, AgentSkillDefinition>();

export function questionTypeFromSkillId(skillId: ThreadSkillId): ThreadQuestionType {
  return QUESTION_TYPE_BY_SKILL_ID[skillId];
}

export function isSectionQuestionType(questionType: ThreadQuestionType): questionType is AskSectionQuestionType {
  return ASK_SECTION_QUESTION_TYPES.includes(questionType as AskSectionQuestionType);
}

export function toAskPrimaryQuestionType(questionType: ThreadQuestionType): ThreadQuestionType {
  if (ASK_BASE_QUESTION_TYPES.includes(questionType as AskBaseQuestionType)) {
    return questionType;
  }
  return "explain_code";
}

export function isSectionSkillId(skillId: ThreadSkillId): skillId is AskSectionSkillId {
  return SECTION_TITLE_BY_SKILL_ID.has(skillId);
}

export function sectionTitleFromSkillId(skillId: ThreadSkillId): string | undefined {
  return SECTION_TITLE_BY_SKILL_ID.get(skillId);
}

export function sectionTitlesFromSkillIds(skillIds: readonly ThreadSkillId[]): string[] {
  const deduped: string[] = [];
  for (const skillId of skillIds) {
    const title = sectionTitleFromSkillId(skillId);
    if (!title || deduped.includes(title)) {
      continue;
    }
    deduped.push(title);
  }
  return deduped;
}

export function requiredSectionTitleFromSkillId(skillId: ThreadSkillId): string {
  return REQUIRED_SECTION_TITLE_BY_SKILL_ID[skillId];
}

export function requiredSectionTitlesFromSkillIds(skillIds: readonly ThreadSkillId[]): string[] {
  const deduped: string[] = [];
  for (const skillId of skillIds) {
    const title = requiredSectionTitleFromSkillId(skillId);
    if (!title || deduped.includes(title)) {
      continue;
    }
    deduped.push(title);
  }
  return deduped;
}

export function detectSectionQuestionTypesFromQuestion(question: string): AskSectionQuestionType[] {
  const normalized = question.toLowerCase();
  return ASK_SECTION_SKILL_RULES
    .filter((rule) => rule.keywordPattern.test(normalized))
    .map((rule) => rule.questionType);
}

export function detectSectionSkillIdsFromQuestion(question: string): AskSectionSkillId[] {
  const normalized = question.toLowerCase();
  return ASK_SECTION_SKILL_RULES
    .filter((rule) => rule.keywordPattern.test(normalized))
    .map((rule) => rule.skillId);
}

export function detectSectionTitlesFromQuestion(question: string): string[] {
  const normalized = question.toLowerCase();
  return ASK_SECTION_SKILL_RULES
    .filter((rule) => rule.keywordPattern.test(normalized))
    .map((rule) => rule.sectionTitle);
}

export function resolveAgentSkill(
  questionType: ThreadQuestionType,
  workspaceRoot: string
): AgentSkillDefinition {
  const cacheKey = `${workspaceRoot}::${questionType}`;
  const cached = SKILL_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const mapping = SKILL_DOC_MAPPINGS[questionType];
  const docPath = path.join(workspaceRoot, ".agents", "skills", mapping.folder, "SKILL.md");
  const fallback = FALLBACK_AGENT_SKILLS[questionType];

  const skill = fs.existsSync(docPath)
    ? loadSkillFromMarkdown(questionType, mapping, docPath, fallback)
    : fallback;
  SKILL_CACHE.set(cacheKey, skill);
  return skill;
}

export function resolveAgentSkillById(
  skillId: ThreadSkillId,
  workspaceRoot: string
): AgentSkillDefinition {
  return resolveAgentSkill(questionTypeFromSkillId(skillId), workspaceRoot);
}

export function resolveAskSkillPool(workspaceRoot: string): AgentSkillDefinition[] {
  return ASK_SKILL_QUESTION_TYPES.map((questionType) => resolveAgentSkill(questionType, workspaceRoot));
}

export function resolveAskPrimarySkillPool(workspaceRoot: string): AgentSkillDefinition[] {
  return ASK_BASE_QUESTION_TYPES.map((questionType) => resolveAgentSkill(questionType, workspaceRoot));
}

export function resolveAskPlannerSkillPool(
  workspaceRoot: string,
  _question: string
): AgentSkillDefinition[] {
  return resolveAskPrimarySkillPool(workspaceRoot);
}

function loadSkillFromMarkdown(
  questionType: ThreadQuestionType,
  mapping: SkillDocMapping,
  docPath: string,
  fallback: AgentSkillDefinition
): AgentSkillDefinition {
  let raw = "";
  try {
    raw = fs.readFileSync(docPath, "utf8");
  } catch {
    return fallback;
  }

  const parsed = parseSkillMarkdown(raw);
  if (!parsed) {
    return fallback;
  }

  const focus = extractPrimaryGoal(parsed.body) ?? fallback.focus;

  return {
    ...fallback,
    id: mapping.id,
    questionType,
    displayName: mapping.displayName,
    focus,
    skillDocDescription: parsed.description || fallback.skillDocDescription,
    skillDocBody: parsed.body || fallback.skillDocBody,
    skillDocPath: docPath
  };
}

function parseSkillMarkdown(input: string): {
  description: string;
  body: string;
} | null {
  const frontmatterMatch = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatterRaw = frontmatterMatch[1] ?? "";
  const body = input.slice(frontmatterMatch[0].length).trim();
  const descriptionMatch = frontmatterRaw.match(/^\s*description:\s*(.+)\s*$/m);

  return {
    description: (descriptionMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, ""),
    body
  };
}

function extractPrimaryGoal(body: string): string | undefined {
  const coreGoalsMatch = body.match(/##\s*Core goals\s*([\s\S]*?)(?:\n##\s|\n#\s|$)/i);
  if (!coreGoalsMatch) {
    return undefined;
  }

  const lines = (coreGoalsMatch[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstGoal = lines.find((line) => /^\d+\.\s+/.test(line) || /^-\s+/.test(line));
  if (!firstGoal) {
    return undefined;
  }

  return firstGoal.replace(/^\d+\.\s+/, "").replace(/^-\s+/, "").trim();
}

export function prioritizeEvidenceForSkill(
  evidence: EvidenceSpan[],
  questionType: ThreadQuestionType
): EvidenceSpan[] {
  const weighted = evidence.map((item, index) => {
    const reason = item.reason.toLowerCase();
    const path = item.path.toLowerCase();
    const excerpt = item.excerpt.toLowerCase();
    let bonus = 0;

    if (questionType === "call_flow") {
      if (reason.includes("call") || reason.includes("graph")) {
        bonus += 4;
      }
      if (reason.includes("active symbol")) {
        bonus += 2;
      }
    } else if (questionType === "risk_review") {
      if (excerpt.includes("throw") || excerpt.includes("catch")) {
        bonus += 3;
      }
      if (excerpt.includes("if") || excerpt.includes("undefined")) {
        bonus += 2;
      }
    } else if (questionType === "module_summary") {
      if (excerpt.includes("export ") || path.includes("index.")) {
        bonus += 3;
      }
    } else if (questionType === "principle") {
      if (excerpt.includes("return") || excerpt.includes("new ")) {
        bonus += 2;
      }
    } else if (questionType === "explain_code") {
      if (reason.includes("active")) {
        bonus += 2;
      }
    } else if (questionType === "input_output") {
      if (excerpt.includes("return") || excerpt.includes("param") || excerpt.includes("argument")) {
        bonus += 3;
      }
      if (excerpt.includes("throw") || excerpt.includes("error")) {
        bonus += 1;
      }
    } else if (questionType === "simplified_pseudocode") {
      if (excerpt.includes("if") || excerpt.includes("for") || excerpt.includes("while")) {
        bonus += 2;
      }
      if (reason.includes("active")) {
        bonus += 2;
      }
    } else if (questionType === "performance_considerations") {
      if (/(for\s*\(|while\s*\(|map\(|filter\(|reduce\(|sort\()/i.test(item.excerpt)) {
        bonus += 3;
      }
      if (excerpt.includes("json.parse") || excerpt.includes("await")) {
        bonus += 1;
      }
    } else if (questionType === "concurrency_state") {
      if (/(async|await|promise|race|lock|mutex|state)/i.test(item.excerpt)) {
        bonus += 3;
      }
    } else if (questionType === "testing_notes") {
      if (/(test|mock|assert|expect|spy)/i.test(item.excerpt) || /(test|spec)\./i.test(path)) {
        bonus += 3;
      }
    } else if (questionType === "refactor_suggestions") {
      if (excerpt.includes("if") || excerpt.includes("switch") || excerpt.includes("try")) {
        bonus += 1;
      }
      if (reason.includes("active")) {
        bonus += 2;
      }
    }

    return {
      item,
      score: item.score + bonus,
      index
    };
  });

  return weighted
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}
