import type { ThreadQuestionType } from "@code-vibe/shared";

import { resolveAgentSkill } from "./skills";

type QuestionPattern = {
  type: ThreadQuestionType;
  keywords: string[];
};

const FALLBACK_QUESTION_PATTERNS: QuestionPattern[] = [
  {
    type: "call_flow",
    keywords: ["调用链", "谁调用", "where called", "call flow", "caller", "callee", "上下游", "upstream", "downstream"]
  },
  {
    type: "risk_review",
    keywords: ["风险", "bug", "问题", "隐患", "edge case", "漏洞", "缺陷", "review risk"]
  },
  {
    type: "module_summary",
    keywords: ["模块", "summary", "职责", "整体", "overview", "boundary", "边界", "总结", "归纳", "tl;dr", "tldr"]
  },
  {
    type: "input_output",
    keywords: ["input", "output", "i/o", "io", "输入", "输出", "入参", "返回值", "参数"]
  },
  {
    type: "simplified_pseudocode",
    keywords: ["pseudocode", "pseudo-code", "伪代码", "流程代码", "简化代码"]
  },
  {
    type: "performance_considerations",
    keywords: ["performance", "复杂度", "性能", "效率", "耗时", "memory", "内存"]
  },
  {
    type: "concurrency_state",
    keywords: ["并发", "线程", "锁", "async", "await", "race", "竞态"]
  },
  {
    type: "testing_notes",
    keywords: ["test", "测试", "用例", "mock", "验证"]
  },
  {
    type: "refactor_suggestions",
    keywords: ["refactor", "重构", "改进", "优化建议"]
  },
  {
    type: "principle",
    keywords: ["原理", "为什么", "机制", "design", "tradeoff", "how it works", "实现思路"]
  },
  {
    type: "explain_code",
    keywords: ["解释", "explain", "what does", "做什么", "看懂", "行为"]
  }
];

const QUESTION_PATTERN_CACHE = new Map<string, QuestionPattern[]>();

export function classifyQuestionType(question: string, workspaceRoot?: string): ThreadQuestionType {
  const normalized = question.trim().toLowerCase();
  const patterns = getQuestionPatterns(workspaceRoot);

  let bestMatch: { type: ThreadQuestionType; score: number; index: number } | null = null;

  for (const [index, candidate] of patterns.entries()) {
    const score = candidate.keywords.reduce((current, keyword) => {
      if (!normalized.includes(keyword)) {
        return current;
      }

      return Math.max(current, keyword.length);
    }, 0);

    if (score <= 0) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && index < bestMatch.index)) {
      bestMatch = {
        type: candidate.type,
        score,
        index
      };
    }
  }

  return bestMatch?.type ?? "explain_code";
}

function getQuestionPatterns(workspaceRoot?: string): QuestionPattern[] {
  if (!workspaceRoot) {
    return FALLBACK_QUESTION_PATTERNS;
  }

  const cached = QUESTION_PATTERN_CACHE.get(workspaceRoot);
  if (cached) {
    return cached;
  }

  const patterns = FALLBACK_QUESTION_PATTERNS.map((entry) => {
    const skill = resolveAgentSkill(entry.type, workspaceRoot);
    const fromDescription = extractDescriptionKeywords(skill.skillDocDescription);

    return {
      type: entry.type,
      keywords: dedupeKeywords([...fromDescription, ...entry.keywords])
    };
  });

  QUESTION_PATTERN_CACHE.set(workspaceRoot, patterns);
  return patterns;
}

function extractDescriptionKeywords(description: string): string[] {
  if (!description.trim()) {
    return [];
  }

  const quoted = Array.from(description.matchAll(/["“”']([^"“”']{2,64})["“”']/g), (match) =>
    normalizeKeyword(match[1] ?? "")
  );

  const normalized = description.replace(/\s+/g, " ").trim();
  const clause = (normalized.match(/use this whenever\s+(.+)$/i)?.[1] ?? normalized)
    .replace(/\beven if\b[\s\S]*$/i, "")
    .replace(/[“”"']/g, "")
    .trim();

  const splitBySeparators = clause
    .split(/,|，|;|；|、|\bor\b|\band\b/i)
    .map((part) =>
      normalizeKeyword(
        part
          .replace(/^(a\s+)?users?\s+ask(?:s)?\s+(about|for)?\s*/i, "")
          .replace(/^any equivalent requests?$/i, "")
      )
    )
    .filter((part) => part.length >= 2 && part.length <= 48);

  return dedupeKeywords([...quoted, ...splitBySeparators]);
}

function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/^[\s\.\-:]+|[\s\.\-:]+$/g, "");
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const keyword of keywords) {
    if (!keyword || seen.has(keyword)) {
      continue;
    }

    seen.add(keyword);
    result.push(keyword);
  }

  return result;
}
