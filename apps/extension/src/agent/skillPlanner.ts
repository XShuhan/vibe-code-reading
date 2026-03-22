import { createModelAdapter, type ModelAdapter } from "@code-vibe/model-gateway";
import type { ModelConfig, ThreadSkillId } from "@code-vibe/shared";

import type { ProjectOverviewSkillId } from "./projectOverviewOrchestrator";
import { resolveProjectOverviewSkills } from "./projectOverviewOrchestrator";
import { detectSectionSkillIdsFromQuestion, resolveAskPrimarySkillPool } from "./skills";

export type SkillPoolKind = "ask" | "overview";

export interface SkillSelectionPlan<TSkillId extends string> {
  primarySkillId: TSkillId;
  secondarySkillIds: TSkillId[];
  reason: string;
}

export interface AskSkillPlannerInput {
  modelConfig: ModelConfig;
  workspaceRoot: string;
  question: string;
  contextSummary: string;
}

export interface OverviewSkillPlannerInput {
  modelConfig: ModelConfig;
  workspaceRoot: string;
  projectObjective: string;
  contextSummary: string;
}

interface PlannerSkillCandidate<TSkillId extends string> {
  id: TSkillId;
  displayName: string;
  description: string;
  focus: string;
  source: string;
}

interface PlanSkillSelectionParams<TSkillId extends string> {
  kind: SkillPoolKind;
  modelConfig: ModelConfig;
  objective: string;
  contextSummary: string;
  candidates: PlannerSkillCandidate<TSkillId>[];
  adapter?: ModelAdapter;
}

const SKILL_PLANNER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["primarySkillId", "secondarySkillIds", "reason"],
  properties: {
    primarySkillId: { type: "string" },
    secondarySkillIds: {
      type: "array",
      items: { type: "string" }
    },
    reason: { type: "string" }
  }
};

export async function planAskSkillSelection(
  input: AskSkillPlannerInput,
  options?: { adapter?: ModelAdapter }
): Promise<SkillSelectionPlan<ThreadSkillId> | null> {
  const primaryCandidates = resolveAskPrimarySkillPool(input.workspaceRoot).map((skill) => ({
    id: skill.id,
    displayName: skill.displayName,
    description: skill.skillDocDescription,
    focus: skill.focus,
    source: skill.skillDocPath ?? "fallback-default"
  }));

  const primaryPlan = await planSkillSelection({
    kind: "ask",
    modelConfig: input.modelConfig,
    objective: input.question,
    contextSummary: input.contextSummary,
    candidates: primaryCandidates,
    adapter: options?.adapter
  });
  if (!primaryPlan) {
    return null;
  }

  const secondarySkillIds = detectSectionSkillIdsFromQuestion(input.question);

  return {
    primarySkillId: primaryPlan.primarySkillId,
    secondarySkillIds: secondarySkillIds as ThreadSkillId[],
    reason:
      secondarySkillIds.length > 0
        ? `${primaryPlan.reason} | Section skills from user intent: ${secondarySkillIds.join(", ")}`
        : primaryPlan.reason
  };
}

export async function planProjectOverviewSkillSelection(
  input: OverviewSkillPlannerInput,
  options?: { adapter?: ModelAdapter }
): Promise<SkillSelectionPlan<ProjectOverviewSkillId> | null> {
  const candidates = resolveProjectOverviewSkills(input.workspaceRoot).map((skill) => ({
    id: skill.id,
    displayName: skill.id,
    description: skill.skillDocDescription,
    focus: skill.focus,
    source: skill.skillDocPath ?? "fallback-default"
  }));

  return planSkillSelection({
    kind: "overview",
    modelConfig: input.modelConfig,
    objective: input.projectObjective,
    contextSummary: input.contextSummary,
    candidates,
    adapter: options?.adapter
  });
}

export async function planSkillSelection<TSkillId extends string>(
  params: PlanSkillSelectionParams<TSkillId>
): Promise<SkillSelectionPlan<TSkillId> | null> {
  if (params.candidates.length === 0) {
    return null;
  }

  const adapter = params.adapter ?? createModelAdapter(params.modelConfig);
  const response = await adapter.completeChat({
    model: params.modelConfig.model,
    temperature: 0,
    maxTokens: Math.min(params.modelConfig.maxTokens || 256, 256),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: `${params.kind}_skill_selection_plan`,
        strict: true,
        schema: SKILL_PLANNER_SCHEMA
      }
    },
    messages: [
      {
        role: "system",
        content: [
          "You are a deterministic skill planner.",
          "Pick one primary skill and optionally secondary skills.",
          "Choose only from the provided candidate ids.",
          "Return strict JSON with keys: primarySkillId, secondarySkillIds, reason.",
          "Do not include markdown fences or extra keys."
        ].join(" ")
      },
      {
        role: "user",
        content: buildSkillPlannerPrompt(params)
      }
    ]
  });

  return parseSkillSelectionResponse(
    response.content,
    params.candidates.map((candidate) => candidate.id)
  );
}

export function parseSkillSelectionResponse<TSkillId extends string>(
  content: string,
  allowedSkillIds: readonly TSkillId[]
): SkillSelectionPlan<TSkillId> | null {
  const parsed = safeParseJsonObject(content);
  if (!parsed) {
    return null;
  }

  return normalizeSkillSelectionPlan(parsed, allowedSkillIds);
}

export function normalizeSkillSelectionPlan<TSkillId extends string>(
  payload: unknown,
  allowedSkillIds: readonly TSkillId[]
): SkillSelectionPlan<TSkillId> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const primarySkillId = readString(payload.primarySkillId);
  if (!primarySkillId) {
    return null;
  }

  const allowedSet = new Set(allowedSkillIds);
  if (!allowedSet.has(primarySkillId as TSkillId)) {
    return null;
  }

  const secondarySkillIds = Array.isArray(payload.secondarySkillIds)
    ? payload.secondarySkillIds.map((item) => readString(item)).filter(Boolean)
    : [];

  const dedupedSecondary = Array.from(new Set(secondarySkillIds));
  if (dedupedSecondary.length !== secondarySkillIds.length) {
    return null;
  }
  if (dedupedSecondary.includes(primarySkillId)) {
    return null;
  }
  if (dedupedSecondary.some((skillId) => !allowedSet.has(skillId as TSkillId))) {
    return null;
  }

  return {
    primarySkillId: primarySkillId as TSkillId,
    secondarySkillIds: dedupedSecondary as TSkillId[],
    reason: readString(payload.reason) || "No reason provided."
  };
}

function buildSkillPlannerPrompt<TSkillId extends string>(
  params: PlanSkillSelectionParams<TSkillId>
): string {
  const candidateSection = params.candidates
    .map((candidate, index) =>
      [
        `${index + 1}. id=${candidate.id}`,
        `name=${candidate.displayName}`,
        `description=${candidate.description}`,
        `focus=${candidate.focus}`,
        `source=${candidate.source}`
      ].join("\n")
    )
    .join("\n\n");

  return [
    `Task pool kind: ${params.kind}.`,
    "Selection constraints:",
    "- Return exactly one primary skill.",
    "- Return zero or more secondary skills.",
    "- Do not return the same skill in both primary and secondary.",
    "- Only use candidate ids from the list.",
    "",
    "Objective:",
    params.objective,
    "",
    "Context summary:",
    params.contextSummary,
    "",
    "Candidate skills:",
    candidateSection
  ].join("\n");
}

function safeParseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = parseJsonCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!blockMatch) {
    return null;
  }

  return parseJsonCandidate(blockMatch[1]);
}

function parseJsonCandidate(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
