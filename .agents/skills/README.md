# Code Vibe Reading Skills

This folder contains project-level skills aligned to `apps/extension/src/agent/skills.ts`.

## Mapping

| Thread question type | Thread skill id      | Skill folder |
| --- | --- | --- |
| `explain_code` | `ExplainSkill` | `explain-skill` |
| `call_flow` | `CallFlowSkill` | `call-flow-skill` |
| `principle` | `PrincipleSkill` | `principle-skill` |
| `risk_review` | `RiskReviewSkill` | `risk-review-skill` |
| `module_summary` | `ModuleSummarySkill` | `module-summary-skill` |
| `input_output` | `InputOutputSkill` | `input-output-skill` |
| `simplified_pseudocode` | `SimplifiedPseudocodeSkill` | `simplified-pseudocode-skill` |
| `performance_considerations` | `PerformanceConsiderationsSkill` | `performance-considerations-skill` |
| `concurrency_state` | `ConcurrencyStateSkill` | `concurrency-state-skill` |
| `testing_notes` | `TestingNotesSkill` | `testing-notes-skill` |
| `refactor_suggestions` | `RefactorSuggestionsSkill` | `refactor-suggestions-skill` |

## Project Overview Mapping

| Overview skill id | Skill folder |
| --- | --- |
| `MissionSkill` | `mission-skill` |
| `BootstrapTraceSkill` | `bootstrap-trace-skill` |
| `ExecutionFlowSkill` | `execution-flow-skill` |

## Notes

- The `description` field in each `SKILL.md` includes both Chinese and English trigger phrases.
- Output structure and focus areas follow the current orchestrator strategy in:
  - `apps/extension/src/agent/skills.ts`
  - `apps/extension/src/agent/questionClassifier.ts`
  - `apps/extension/src/agent/questionOrchestrator.ts`
- Project overview skill loading is implemented in:
  - `apps/extension/src/agent/projectOverviewOrchestrator.ts`
