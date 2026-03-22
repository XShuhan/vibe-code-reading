import { describe, expect, it } from "vitest";

import type { StructuredThreadAnswer, Thread } from "@code-vibe/shared";

import { SkillMemoryBank } from "./skillMemory";

describe("skillMemory section skill support", () => {
  it("hydrates section-based answers into memory instructions", () => {
    const bank = new SkillMemoryBank();
    bank.hydrate([makeThread("thread-1", makeSectionAnswer("input_output"))]);

    const instructions = bank.getInstructions("input_output");
    expect(instructions.length).toBe(1);
    expect(instructions[0]).toContain("input/output contracts");
  });

  it("records section-based answers and returns learned hints for that question type", () => {
    const bank = new SkillMemoryBank();
    bank.record("thread-2", makeSectionAnswer("testing_notes"));

    const instructions = bank.getInstructions("testing_notes");
    expect(instructions.length).toBe(1);
    expect(instructions[0]).toContain("targeted tests");
  });
});

function makeThread(threadId: string, structuredAnswer: StructuredThreadAnswer): Thread {
  return {
    id: threadId,
    workspaceId: "workspace_1",
    title: "thread",
    questionType: structuredAnswer.questionType,
    skillId: structuredAnswer.skillId,
    createdAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
    contextRefs: ["src/auth.ts"],
    messages: [
      {
        id: `${threadId}-u`,
        role: "user",
        content: "question",
        citations: [],
        createdAt: "2026-03-23T00:00:00.000Z"
      },
      {
        id: `${threadId}-a`,
        role: "assistant",
        content: "answer",
        citations: [],
        structuredAnswer,
        createdAt: "2026-03-23T00:00:01.000Z"
      }
    ]
  };
}

function makeSectionAnswer(
  questionType: "input_output" | "testing_notes"
): StructuredThreadAnswer {
  if (questionType === "input_output") {
    return {
      questionType,
      skillId: "InputOutputSkill",
      questionRestatement: "Clarify contract boundaries for this function.",
      conclusion: "The function takes validated user payload and returns token metadata.",
      codeBehavior: "",
      principle: "",
      callFlow: "",
      risks: "",
      uncertainty: "",
      sourceReferences: ["src/auth.ts:10-32"],
      sections: [
        {
          title: "Input / Output",
          content:
            "Inputs require userId and tenant context; output includes token string, expiration timestamp, and audit side effects."
        }
      ],
      extraSections: []
    };
  }

  return {
    questionType,
    skillId: "TestingNotesSkill",
    questionRestatement: "Provide high-value tests for the token flow.",
    conclusion: "Focus on token issuance success/failure and boundary conditions.",
    codeBehavior: "",
    principle: "",
    callFlow: "",
    risks: "",
    uncertainty: "",
    sourceReferences: ["src/auth.ts:10-32"],
    sections: [
      {
        title: "Testing Notes",
        content:
          "Add happy path, invalid input, and dependency failure tests with mocked token signer and assertion on emitted audit event."
      }
    ],
    extraSections: []
  };
}
