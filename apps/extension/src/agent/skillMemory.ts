import type { StructuredThreadAnswer, Thread, ThreadQuestionType } from "@code-vibe/shared";

interface LearnedSkill {
  id: string;
  questionType: ThreadQuestionType;
  instruction: string;
  sourceThreadId: string;
}

const MAX_SKILLS_PER_TYPE = 3;

export class SkillMemoryBank {
  private readonly skillsByType = new Map<ThreadQuestionType, LearnedSkill[]>();

  hydrate(threads: Thread[]): void {
    this.skillsByType.clear();

    for (const thread of threads) {
      const answer = thread.messages.findLast((message) => message.role === "assistant")?.structuredAnswer;
      if (!answer || !isPromotableAnswer(answer)) {
        continue;
      }

      this.addSkill({
        id: `${thread.id}:${answer.questionType}`,
        questionType: answer.questionType,
        instruction: distillInstruction(answer),
        sourceThreadId: thread.id
      });
    }
  }

  record(threadId: string, answer: StructuredThreadAnswer | undefined): void {
    if (!answer || !isPromotableAnswer(answer)) {
      return;
    }

    this.addSkill({
      id: `${threadId}:${answer.questionType}:${Date.now()}`,
      questionType: answer.questionType,
      instruction: distillInstruction(answer),
      sourceThreadId: threadId
    });
  }

  getInstructions(questionType: ThreadQuestionType): string[] {
    const entries = this.skillsByType.get(questionType) ?? [];
    return entries.map((entry) => entry.instruction);
  }

  private addSkill(skill: LearnedSkill): void {
    const current = this.skillsByType.get(skill.questionType) ?? [];
    if (current.some((entry) => entry.instruction === skill.instruction)) {
      return;
    }

    const next = [skill, ...current]
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, MAX_SKILLS_PER_TYPE);
    this.skillsByType.set(skill.questionType, next);
  }
}

function isPromotableAnswer(answer: StructuredThreadAnswer): boolean {
  const sectionText = collectSectionText(answer);
  const hasUsefulBody =
    answer.codeBehavior.trim().length > 80 ||
    answer.callFlow.trim().length > 80 ||
    sectionText.length > 120;
  const hasSummary =
    answer.conclusion.trim().length > 24 ||
    answer.questionRestatement.trim().length > 24 ||
    (answer.sections?.length ?? 0) > 0;

  return (
    hasSummary &&
    hasUsefulBody &&
    !/not enough grounded evidence/i.test(answer.conclusion)
  );
}

function distillInstruction(answer: StructuredThreadAnswer): string {
  const hints: string[] = [];
  const sectionLookup = new Map<string, string>(
    [...(answer.sections ?? []), ...(answer.extraSections ?? [])].map((section) => [
      section.title.toLowerCase().replace(/\s+/g, " ").trim(),
      section.content
    ])
  );

  if (sectionLookup.has("input / output")) {
    hints.push("State clear input/output contracts, including return shape and side effects.");
  }
  if (sectionLookup.has("simplified pseudocode")) {
    hints.push("Provide concise pseudocode that preserves guard conditions and branch order.");
  }
  if (sectionLookup.has("performance considerations")) {
    hints.push("Identify dominant cost paths and explain practical optimization tradeoffs.");
  }
  if (sectionLookup.has("concurrency / state")) {
    hints.push("Call out async boundaries, shared state transitions, and race windows.");
  }
  if (sectionLookup.has("testing notes")) {
    hints.push("Propose targeted tests for happy path, edge cases, and failure handling.");
  }
  if (sectionLookup.has("refactor suggestions")) {
    hints.push("Suggest incremental refactors with behavior-preserving migration steps.");
  }

  if (containsStepStyle(answer.codeBehavior)) {
    hints.push("Describe code behavior in ordered steps.");
  }
  if (answer.callFlow.includes("->")) {
    hints.push("Represent call flow as an arrow chain from entry to sink.");
  }
  if (answer.risks.length > 0) {
    hints.push("Name concrete risk with condition and impact.");
  }
  if (answer.principle.length > 0) {
    hints.push("Explain why the design works before discussing edge cases.");
  }

  if (hints.length === 0) {
    hints.push("Keep answer concrete, evidence-grounded, and logically ordered.");
  }

  return hints.join(" ");
}

function containsStepStyle(text: string): boolean {
  return /(?:^|\s)(?:\d+[.)]|first|second|third|then)\s/i.test(text);
}

function collectSectionText(answer: StructuredThreadAnswer): string {
  return [...(answer.sections ?? []), ...(answer.extraSections ?? [])]
    .map((section) => `${section.title}\n${section.content}`)
    .join("\n")
    .trim();
}

