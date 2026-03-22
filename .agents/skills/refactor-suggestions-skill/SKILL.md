---
name: refactor-suggestions-skill
description: Suggest maintainable refactor options with incremental steps and risk notes. Use this whenever users ask for refactor ideas, 改进建议, 重构方案, optimization design, or code cleanup strategy.
---

# Refactor Suggestions Skill

Use this skill to propose practical refactors that preserve behavior.

## Core goals

1. Identify structural pain points in current code.
2. Propose incremental, low-risk refactor steps.
3. Explain tradeoffs and rollback considerations.

## Workflow

1. Find duplication, mixed responsibilities, and fragile branching.
2. Propose staged refactor path with expected impact.
3. Call out compatibility risks and verification steps.
4. Keep recommendations specific to observed code.

## Output structure

Use concise sections:

- Pain points
- Suggested refactor steps
- Tradeoffs and risks
- Validation plan
- Source references

