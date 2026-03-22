import type { StructuredSection, StructuredThreadAnswer } from "@code-vibe/shared";

export const CANONICAL_SECTION_TITLES = [
  "Code Behavior",
  "Module Responsibilities",
  "Mechanism",
  "Risk Register",
  "Input / Output",
  "Simplified Pseudocode",
  "Performance Considerations",
  "Concurrency / State",
  "Testing Notes",
  "Refactor Suggestions",
  "Call flow / upstream-downstream"
] as const;

type CanonicalSectionTitle = typeof CANONICAL_SECTION_TITLES[number];

export const MISSING_SECTION_PLACEHOLDER =
  "Requested section unavailable due to insufficient grounded evidence in current response.";

const CANONICAL_TITLE_ALIASES: Record<CanonicalSectionTitle, string[]> = {
  "Code Behavior": [
    "code behavior",
    "what the code is doing",
    "behavior",
    "runtime behavior",
    "代码行为",
    "代码作用"
  ],
  "Module Responsibilities": [
    "module responsibilities",
    "module responsibility",
    "responsibilities",
    "module scope",
    "模块职责"
  ],
  Mechanism: [
    "mechanism",
    "design rationale",
    "principle",
    "why this design",
    "机制",
    "原理"
  ],
  "Risk Register": [
    "risk register",
    "risks",
    "risk",
    "top priorities",
    "mitigations",
    "testing focus",
    "风险",
    "风险清单"
  ],
  "Input / Output": [
    "input output",
    "inputs outputs",
    "input",
    "output",
    "inputs",
    "outputs",
    "i/o",
    "io",
    "contract",
    "contracts",
    "输入输出",
    "输入 / 输出",
    "入参返回值",
    "参数返回值"
  ],
  "Simplified Pseudocode": [
    "simplified pseudocode",
    "pseudocode",
    "pseudo code",
    "伪代码",
    "流程代码",
    "简化代码"
  ],
  "Performance Considerations": [
    "performance considerations",
    "performance",
    "complexity",
    "复杂度",
    "性能",
    "效率",
    "耗时",
    "memory",
    "内存"
  ],
  "Concurrency / State": [
    "concurrency state",
    "concurrency",
    "state",
    "async",
    "await",
    "race",
    "thread",
    "threads",
    "并发",
    "线程",
    "锁",
    "竞态"
  ],
  "Testing Notes": [
    "testing notes",
    "testing",
    "tests",
    "test cases",
    "test case",
    "mock strategy",
    "测试",
    "用例",
    "验证",
    "mock"
  ],
  "Refactor Suggestions": [
    "refactor suggestions",
    "refactor",
    "refactoring",
    "重构",
    "改进",
    "优化建议"
  ],
  "Call flow / upstream-downstream": [
    "call flow",
    "call chain",
    "caller callee",
    "upstream downstream",
    "upstream",
    "downstream",
    "impact analysis",
    "调用链",
    "上下游",
    "谁调用"
  ]
};

const ALIAS_TO_CANONICAL = buildAliasLookup();

export function buildRequestedSectionTitleMap(requestedTitles: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const title of requestedTitles) {
    const trimmed = title.trim();
    if (!trimmed) {
      continue;
    }
    const key = toSectionMatchKey(trimmed);
    if (map.has(key)) {
      continue;
    }
    map.set(key, trimmed);
  }
  return map;
}

export function mergeRequestedSectionsIntoPrimary(
  answer: StructuredThreadAnswer | undefined,
  requestedTitles: string[]
): StructuredThreadAnswer | undefined {
  if (!answer || requestedTitles.length === 0) {
    return answer;
  }

  const requestedTitleMap = buildRequestedSectionTitleMap(requestedTitles);
  if (requestedTitleMap.size === 0) {
    return answer;
  }

  const primarySections = answer.sections ?? [];
  const extraSections = answer.extraSections ?? [];
  const usedPrimary = new Set<number>();
  const usedExtra = new Set<number>();
  const normalizedRequestedSections: StructuredSection[] = [];

  for (const [key, requestedTitle] of requestedTitleMap.entries()) {
    const matchedContents: string[] = [];

    for (let index = 0; index < primarySections.length; index += 1) {
      if (toSectionMatchKey(primarySections[index]?.title ?? "") !== key) {
        continue;
      }
      usedPrimary.add(index);
      const content = (primarySections[index]?.content ?? "").trim();
      if (content) {
        matchedContents.push(content);
      }
    }

    for (let index = 0; index < extraSections.length; index += 1) {
      if (toSectionMatchKey(extraSections[index]?.title ?? "") !== key) {
        continue;
      }
      usedExtra.add(index);
      const content = (extraSections[index]?.content ?? "").trim();
      if (content) {
        matchedContents.push(content);
      }
    }

    normalizedRequestedSections.push({
      title: requestedTitle,
      content: mergeUniqueContents(matchedContents) || MISSING_SECTION_PLACEHOLDER
    });
  }

  const remainingPrimary = primarySections.filter((_, index) => !usedPrimary.has(index));
  const remainingExtra = extraSections.filter((_, index) => !usedExtra.has(index));

  return {
    ...answer,
    sections: [...normalizedRequestedSections, ...remainingPrimary],
    extraSections: remainingExtra
  };
}

export function filterStructuredAnswerByRequestedTitles(
  answer: StructuredThreadAnswer | undefined,
  requestedTitleMap: Map<string, string> | null
): StructuredThreadAnswer | undefined {
  if (!answer || !requestedTitleMap || !answer.sections || answer.sections.length === 0) {
    return answer;
  }

  const mergedByKey = new Map<string, string[]>();
  for (const section of answer.sections) {
    const key = toSectionMatchKey(section.title);
    if (!requestedTitleMap.has(key)) {
      continue;
    }
    const bucket = mergedByKey.get(key) ?? [];
    bucket.push(section.content);
    mergedByKey.set(key, bucket);
  }

  const filteredSections: StructuredSection[] = [];
  for (const [key, requestedTitle] of requestedTitleMap.entries()) {
    const contents = mergedByKey.get(key);
    if (!contents || contents.length === 0) {
      continue;
    }
    filteredSections.push({
      title: requestedTitle,
      content: mergeUniqueContents(contents) || MISSING_SECTION_PLACEHOLDER
    });
  }
  if (filteredSections.length === 0) {
    return answer;
  }

  return {
    ...answer,
    sections: filteredSections,
    extraSections: [],
    codeBehavior: "",
    principle: "",
    callFlow: "",
    risks: "",
    uncertainty: ""
  };
}

export function toSectionMatchKey(value: string): string {
  const canonical = canonicalizeSectionTitle(value);
  return normalizeSectionTitleKey(canonical ?? value);
}

export function canonicalizeSectionTitle(value: string): CanonicalSectionTitle | undefined {
  const key = normalizeSectionTitleKey(value);
  if (!key) {
    return undefined;
  }

  const fromAlias = ALIAS_TO_CANONICAL.get(key);
  if (fromAlias) {
    return fromAlias;
  }

  if (
    key.includes("call flow") ||
    key.includes("call chain") ||
    key.includes("caller") ||
    key.includes("callee") ||
    key.includes("upstream") ||
    key.includes("downstream") ||
    key.includes("impact analysis") ||
    key.includes("调用链") ||
    key.includes("上下游")
  ) {
    return "Call flow / upstream-downstream";
  }

  const isInputLike = key.includes("input") || key.includes("输入") || key === "io" || key === "i o";
  const isOutputLike = key.includes("output") || key.includes("输出") || key.includes("返回");
  if ((isInputLike && isOutputLike) || key.includes("input output")) {
    return "Input / Output";
  }

  return undefined;
}

function normalizeSectionTitleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[\s>.\-_*~]*(?:\(?\d+\)?[.)\-:]?\s*)+/, "")
    .replace(/^[\s>.\-_*~]+/, "")
    .replace(/[/:：\\|]+/g, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/[()[\]{}"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliasLookup(): Map<string, CanonicalSectionTitle> {
  const map = new Map<string, CanonicalSectionTitle>();
  for (const title of CANONICAL_SECTION_TITLES) {
    const canonicalKey = normalizeSectionTitleKey(title);
    map.set(canonicalKey, title);
    for (const alias of CANONICAL_TITLE_ALIASES[title]) {
      const aliasKey = normalizeSectionTitleKey(alias);
      if (!aliasKey) {
        continue;
      }
      map.set(aliasKey, title);
    }
  }
  return map;
}

function mergeUniqueContents(contents: string[]): string {
  const deduped: string[] = [];
  for (const content of contents) {
    const trimmed = content.trim();
    if (!trimmed || deduped.includes(trimmed)) {
      continue;
    }
    deduped.push(trimmed);
  }
  return deduped.join("\n\n");
}
