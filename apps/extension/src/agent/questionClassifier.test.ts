import { describe, expect, it } from "vitest";

import { classifyQuestionType } from "./questionClassifier";

describe("questionClassifier section skill fallback patterns", () => {
  it("classifies input/output questions", () => {
    expect(classifyQuestionType("请分析这个函数的输入输出和参数约束")).toBe("input_output");
  });

  it("classifies pseudocode requests", () => {
    expect(classifyQuestionType("帮我写一份伪代码版本")).toBe("simplified_pseudocode");
  });

  it("classifies performance questions", () => {
    expect(classifyQuestionType("这里的性能复杂度和内存开销如何")).toBe(
      "performance_considerations"
    );
  });

  it("classifies concurrency/state questions", () => {
    expect(classifyQuestionType("这里有并发竞态风险吗，async await 顺序怎么保证")).toBe(
      "concurrency_state"
    );
  });

  it("classifies testing questions", () => {
    expect(classifyQuestionType("请给我测试用例和 mock 建议")).toBe("testing_notes");
  });

  it("classifies refactor questions", () => {
    expect(classifyQuestionType("这段代码怎么重构更好")).toBe("refactor_suggestions");
  });
});
