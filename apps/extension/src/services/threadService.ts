import * as vscode from "vscode";

import { buildSelectionQuestionContext } from "@code-vibe/retrieval";
import { generateThreadTitle, parseStructuredAnswerSnapshot, streamGroundedQuestion } from "@code-vibe/model-gateway";
import type {
  EditorSelectionState,
  EvidenceSpan,
  ModelConfig,
  QuestionContext,
  Thread,
  ThreadMessage,
  ThreadSkillId
} from "@code-vibe/shared";
import { createId, nowIso } from "@code-vibe/shared";

import type { PersistenceLayer } from "@code-vibe/persistence";

import { assertModelConfigured } from "../config/settings";
import { planAskSkillSelection } from "../agent/skillPlanner";
import { classifyQuestionType } from "../agent/questionClassifier";
import { orchestrateQuestion } from "../agent/questionOrchestrator";
import {
  detectSectionSkillIdsFromQuestion,
  questionTypeFromSkillId,
  resolveAgentSkill,
  toAskPrimaryQuestionType
} from "../agent/skills";
import { SkillMemoryBank } from "../agent/skillMemory";
import {
  buildRequestedSectionTitleMap,
  filterStructuredAnswerByRequestedTitles,
  mergeRequestedSectionsIntoPrimary
} from "./sectionOrchestration";
import type { IndexService } from "./indexService";

export class ThreadService {
  private threads: Thread[] = [];
  private readonly skillMemory = new SkillMemoryBank();
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly persistence: PersistenceLayer,
    private readonly indexService: IndexService,
    private readonly output: vscode.OutputChannel
  ) {}

  async initialize(): Promise<void> {
    this.threads = await this.persistence.loadThreads();
    this.skillMemory.hydrate(this.threads);
    this.emitter.fire();
  }

  getThreads(): Thread[] {
    return [...this.threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getThread(threadId: string): Thread | undefined {
    return this.threads.find((thread) => thread.id === threadId);
  }

  async deleteThread(threadId: string): Promise<boolean> {
    const nextThreads = this.threads.filter((thread) => thread.id !== threadId);
    if (nextThreads.length === this.threads.length) {
      return false;
    }

    this.threads = nextThreads;
    await this.persistence.saveThreads(this.threads);
    this.emitter.fire();
    return true;
  }

  async askQuestion(
    question: string,
    editorState: NonNullable<ReturnType<typeof import("../editor/selectionContext").getActiveSelectionState>>,
    modelConfig: ModelConfig,
    options?: {
      onThreadCreated?: (thread: Thread) => Promise<void> | void;
    }
  ): Promise<Thread> {
    assertModelConfigured(modelConfig);

    const index = await this.indexService.ensureIndex();
    const { context, evidence } = buildSelectionQuestionContext(index, editorState, question);
    this.output.appendLine(`[retrieval] evidence_count=${evidence.length}`);

    const fallbackQuestionType = classifyQuestionType(question, this.indexService.getRootPath());
    const fallbackPrimaryQuestionType = toAskPrimaryQuestionType(fallbackQuestionType);
    let questionType = fallbackPrimaryQuestionType;
    let selectedSkillIds: ThreadSkillId[] = [
      resolveAgentSkill(fallbackPrimaryQuestionType, this.indexService.getRootPath()).id,
      ...detectSectionSkillIdsFromQuestion(question)
    ];
    let selectionReason = "fallback=classifier(base) + keyword-sections";

    try {
      const plan = await planAskSkillSelection({
        modelConfig,
        workspaceRoot: this.indexService.getRootPath(),
        question,
        contextSummary: buildAskPlannerContextSummary(editorState, context, evidence)
      });
      if (plan) {
        selectedSkillIds = [plan.primarySkillId, ...plan.secondarySkillIds];
        selectionReason = plan.reason;
        questionType = questionTypeFromSkillId(plan.primarySkillId);
        this.output.appendLine(
          `[agent-planner] pool=ask primary=${plan.primarySkillId} secondary=${plan.secondarySkillIds.join(",") || "none"} reason=${compactLogText(plan.reason)}`
        );
      } else {
        this.output.appendLine(
          `[agent-planner] pool=ask fallback=classifier primary=${selectedSkillIds[0] ?? "ExplainSkill"} secondary=${selectedSkillIds.slice(1).join(",") || "none"} reason=invalid_or_empty_plan`
        );
      }
    } catch (error) {
      this.output.appendLine(
        `[agent-planner] pool=ask fallback=classifier primary=${selectedSkillIds[0] ?? "ExplainSkill"} secondary=${selectedSkillIds.slice(1).join(",") || "none"} error=${compactLogText(String(error))}`
      );
    }

    const learnedSkillInstructions = this.skillMemory.getInstructions(questionType);
    const orchestrated = orchestrateQuestion({
      question,
      editorState,
      context,
      evidence,
      workspaceRoot: this.indexService.getRootPath(),
      forcedQuestionType: questionType,
      learnedSkillInstructions,
      selectedSkillIds,
      selectionReason
    });
    this.output.appendLine(
      `[agent] question_type=${orchestrated.questionType} skill=${orchestrated.skillId} evidence_count=${orchestrated.prioritizedEvidence.length}`
    );

    const title = deriveThreadTitle(question, editorState.activeFile);
    const createdAt = nowIso();
    const assistantMessageId = createId("message");
    const thread: Thread = {
      id: createId("thread"),
      workspaceId: index.snapshot.id,
      title,
      questionType: orchestrated.questionType,
      skillId: orchestrated.skillId,
      createdAt,
      updatedAt: createdAt,
      contextRefs: [editorState.activeFile],
      messages: [
        {
          id: createId("message"),
          role: "user",
          content: question,
          citations: [],
          createdAt
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: "Generating answer...",
          citations: [],
          streamStatus: {
            isStreaming: true,
            currentSection: "Preparing answer"
          },
          createdAt
        }
      ]
    };

    this.threads = [thread, ...this.threads];
    await this.persistence.saveThreads(this.threads);
    this.emitter.fire();
    if (options?.onThreadCreated) {
      await options.onThreadCreated(thread);
    }

    let streamedText = "";
    let finalStructuredAnswer: ThreadMessage["structuredAnswer"] | undefined;
    const strictSectionTitleMap =
      orchestrated.focusMode === "focused" && orchestrated.requestedSections.length > 0
        ? buildRequestedSectionTitleMap(orchestrated.requestedSections)
        : null;
    const provisionalCitations = orchestrated.prioritizedEvidence.map((item, index) => ({
      id: `citation_${index + 1}`,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      symbolId: item.symbolId,
      label: `${item.path}:${item.startLine}-${item.endLine}`
    }));
    try {
      for await (const event of streamGroundedQuestion(modelConfig, context, orchestrated.prioritizedEvidence, {
        systemInstruction: orchestrated.systemInstruction,
        promptInstruction: orchestrated.promptInstruction,
        questionType: orchestrated.questionType,
        skillId: orchestrated.skillId,
        structuredOutput: true
      })) {
        if (event.type === "delta") {
          streamedText += event.delta;
          const snapshot = parseStructuredAnswerSnapshot({
            content: streamedText,
            questionType: orchestrated.questionType,
            skillId: orchestrated.skillId,
            sourceReferences: provisionalCitations.map((citation) => citation.label)
          });
          const normalizedSnapshot = mergeRequestedSectionsIntoPrimary(
            snapshot,
            orchestrated.requestedSections
          );
          const filteredSnapshot = filterStructuredAnswerByRequestedTitles(
            normalizedSnapshot,
            strictSectionTitleMap
          );
          this.updateAssistantMessage(thread.id, assistantMessageId, {
            content: streamedText || "Generating answer...",
            structuredAnswer: filteredSnapshot,
            citations: filteredSnapshot ? provisionalCitations : [],
            streamStatus: {
              isStreaming: true,
              currentSection: inferCurrentSection(filteredSnapshot)
            }
          });
          continue;
        }

        const normalizedFinal = mergeRequestedSectionsIntoPrimary(
          event.answer.structuredAnswer,
          orchestrated.requestedSections
        );
        const filteredFinal = filterStructuredAnswerByRequestedTitles(
          normalizedFinal,
          strictSectionTitleMap
        );
        this.updateAssistantMessage(thread.id, assistantMessageId, {
          content: event.answer.answerMarkdown,
          structuredAnswer: filteredFinal,
          citations: event.answer.citations,
          streamStatus: {
            isStreaming: false
          }
        });
        this.setThreadContextRefs(thread.id, [editorState.activeFile, ...event.answer.citations.map((item) => item.label)]);
        finalStructuredAnswer = filteredFinal;
        this.skillMemory.record(thread.id, filteredFinal);
      }
    } catch (error) {
      this.updateAssistantMessage(thread.id, assistantMessageId, {
        content: `Error: ${String(error)}`,
        streamStatus: {
          isStreaming: false
        }
      });
      await this.persistence.saveThreads(this.threads);
      this.emitter.fire();
      throw error;
    }

    const refinedTitle = await generateThreadTitle(modelConfig, {
      question,
      questionType: orchestrated.questionType,
      structuredAnswer: finalStructuredAnswer
    }).catch(() => undefined);
    if (refinedTitle) {
      this.setThreadTitle(thread.id, refinedTitle);
    }

    await this.persistence.saveThreads(this.threads);
    this.emitter.fire();
    return thread;
  }

  getLatestAssistantMessage(threadId: string): ThreadMessage | undefined {
    return this.getThread(threadId)?.messages.findLast((message: ThreadMessage) => message.role === "assistant");
  }

  private updateAssistantMessage(
    threadId: string,
    messageId: string,
    patch: Partial<ThreadMessage>
  ): void {
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) {
      return;
    }

    thread.messages = thread.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            ...patch,
            createdAt: message.createdAt
          }
        : message
    );
    thread.updatedAt = nowIso();
    this.emitter.fire();
  }

  private setThreadContextRefs(threadId: string, refs: string[]): void {
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) {
      return;
    }
    thread.contextRefs = refs;
    thread.updatedAt = nowIso();
  }

  private setThreadTitle(threadId: string, title: string): void {
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread) {
      return;
    }
    thread.title = title;
    thread.updatedAt = nowIso();
  }
}

function deriveThreadTitle(question: string, filePath: string): string {
  const trimmed = question.trim();
  if (trimmed.length > 0) {
    return compactTitle(trimmed, 54);
  }

  return `Explain ${filePath}`;
}

function inferCurrentSection(answer: ThreadMessage["structuredAnswer"]): string {
  if (!answer) {
    return "Generating";
  }

  if (answer.sections && answer.sections.length > 0) {
    const last = [...answer.sections].reverse().find((section) => section.content.trim().length > 0);
    return last?.title ?? "Generating";
  }

  const candidates: Array<{ title: string; value: string }> = [
    { title: "Question restatement", value: answer.questionRestatement },
    { title: "Conclusion first", value: answer.conclusion },
    { title: "What the code is doing", value: answer.codeBehavior },
    { title: "Why / principle", value: answer.principle },
    { title: "Call flow / upstream-downstream", value: answer.callFlow },
    { title: "Risks / uncertainties", value: `${answer.risks}\n${answer.uncertainty}` }
  ];

  const last = [...candidates].reverse().find((item) => item.value.trim().length > 0);
  return last?.title ?? "Generating";
}

function compactTitle(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const slice = normalized.slice(0, maxLength - 3).trim();
  const lastSpace = slice.lastIndexOf(" ");
  const safe = lastSpace > 16 ? slice.slice(0, lastSpace) : slice;
  return `${safe}...`;
}

function buildAskPlannerContextSummary(
  editorState: EditorSelectionState,
  context: QuestionContext,
  evidence: EvidenceSpan[]
): string {
  const evidencePreview =
    evidence
      .slice(0, 4)
      .map(
        (item, index) =>
          `${index + 1}. ${item.path}:${item.startLine}-${item.endLine} reason=${item.reason} score=${item.score.toFixed(2)}`
      )
      .join("\n") || "none";

  return [
    `activeFile=${editorState.activeFile}`,
    `selection=${editorState.startLine}-${editorState.endLine}`,
    `activeSymbol=${context.activeSymbolId ?? "unknown"}`,
    `selectedTextPreview=${editorState.selectedText.slice(0, 220).replace(/\s+/g, " ").trim() || "none"}`,
    `evidenceCount=${evidence.length}`,
    "topEvidence:",
    evidencePreview
  ].join("\n");
}

function compactLogText(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}
