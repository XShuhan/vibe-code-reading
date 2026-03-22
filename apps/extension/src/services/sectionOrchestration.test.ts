import type { StructuredThreadAnswer } from "@code-vibe/shared";
import { describe, expect, it } from "vitest";

import {
  MISSING_SECTION_PLACEHOLDER,
  buildRequestedSectionTitleMap,
  filterStructuredAnswerByRequestedTitles,
  mergeRequestedSectionsIntoPrimary
} from "./sectionOrchestration";

describe("sectionOrchestration", () => {
  it("merges call-flow aliases into canonical requested section", () => {
    const answer = makeAnswer({
      sections: [
        { title: "Call Flow", content: "Entry -> Target" },
        { title: "Upstream", content: "Caller A, Caller B" },
        { title: "Downstream", content: "Dependency X" }
      ],
      extraSections: [{ title: "Impact Analysis", content: "Change affects auth and cache paths." }]
    });

    const merged = mergeRequestedSectionsIntoPrimary(answer, ["Call flow / upstream-downstream"]);

    expect(merged?.sections?.[0]?.title).toBe("Call flow / upstream-downstream");
    expect(merged?.sections?.[0]?.content).toContain("Entry -> Target");
    expect(merged?.sections?.[0]?.content).toContain("Caller A, Caller B");
    expect(merged?.sections?.[0]?.content).toContain("Dependency X");
    expect(merged?.sections?.[0]?.content).toContain("Change affects auth and cache paths.");
    expect(merged?.extraSections).toEqual([]);
  });

  it("keeps requested section order and avoids loss under strict filtering", () => {
    const requested = ["Input / Output", "Simplified Pseudocode", "Call flow / upstream-downstream"];
    const answer = makeAnswer({
      sections: [
        { title: "Inputs", content: "Requires userId and session options." },
        { title: "Outputs", content: "Returns token payload." },
        { title: "Simplified pseudocode", content: "if missing userId -> throw; else return issueToken(userId)" },
        { title: "Call Flow", content: "API -> createSession -> issueToken" },
        { title: "Impact Analysis", content: "Affects auth middleware and token validators." },
        { title: "Other Heading", content: "Non-requested content." }
      ]
    });

    const merged = mergeRequestedSectionsIntoPrimary(answer, requested);
    const filtered = filterStructuredAnswerByRequestedTitles(
      merged,
      buildRequestedSectionTitleMap(requested)
    );

    expect(filtered?.sections?.map((section) => section.title)).toEqual(requested);
    for (const section of filtered?.sections ?? []) {
      expect(section.content.trim().length).toBeGreaterThan(0);
    }
    expect(filtered?.extraSections).toEqual([]);
    expect(filtered?.codeBehavior).toBe("");
    expect(filtered?.callFlow).toBe("");
  });

  it("promotes alias sections from extraSections into primary requested section", () => {
    const answer = makeAnswer({
      sections: [],
      extraSections: [
        { title: "Inputs", content: "input: request body + headers" },
        { title: "Outputs", content: "output: normalized response object" }
      ]
    });

    const merged = mergeRequestedSectionsIntoPrimary(answer, ["Input / Output"]);

    expect(merged?.sections?.[0]?.title).toBe("Input / Output");
    expect(merged?.sections?.[0]?.content).toContain("input: request body + headers");
    expect(merged?.sections?.[0]?.content).toContain("output: normalized response object");
    expect(merged?.extraSections).toEqual([]);
  });

  it("fills missing requested section with placeholder instead of dropping it", () => {
    const answer = makeAnswer({
      sections: [{ title: "Simplified Pseudocode", content: "guard -> transform -> return" }]
    });

    const merged = mergeRequestedSectionsIntoPrimary(answer, [
      "Input / Output",
      "Simplified Pseudocode"
    ]);

    expect(merged?.sections?.map((section) => section.title)).toEqual([
      "Input / Output",
      "Simplified Pseudocode"
    ]);
    expect(merged?.sections?.[0]?.content).toBe(MISSING_SECTION_PLACEHOLDER);
    expect(merged?.sections?.[1]?.content).toContain("guard -> transform -> return");
  });
});

function makeAnswer(
  overrides?: Partial<Pick<StructuredThreadAnswer, "sections" | "extraSections">>
): StructuredThreadAnswer {
  return {
    questionType: "call_flow",
    skillId: "CallFlowSkill",
    questionRestatement: "",
    conclusion: "",
    codeBehavior: "base behavior",
    principle: "",
    callFlow: "base call flow",
    risks: "",
    uncertainty: "",
    sourceReferences: [],
    sections: overrides?.sections ?? [],
    extraSections: overrides?.extraSections ?? []
  };
}
