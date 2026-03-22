---
name: principle-skill
description: Explain implementation principles, tradeoffs, and mechanism-level reasoning behind code decisions. Use this whenever users ask "why this design", "原理", "机制", "tradeoff", "实现思路", "为什么这么做", or architectural intent questions.
---

# Principle Skill

Use this skill when the user needs "why", not just "what".

## Core goals

1. Explain why the implementation works.
2. Surface tradeoffs and constraints behind current choices.
3. Compare practical alternatives without overengineering.

## Workflow

1. Identify the design decision under discussion.
   - Pattern choice, control strategy, data shape, error policy, etc.
2. Explain mechanism first.
   - Describe cause-effect chain at runtime.
3. Explain tradeoffs second.
   - Benefits, costs, and constraints (complexity, performance, maintainability, safety).
4. Compare alternatives.
   - Mention 1-2 plausible alternatives and why current design may have been chosen.
5. Add decision guidance.
   - State when the current design is a good fit and when it is not.

## Output structure

Use this section order:


1. `Mechanism`
2. `Design Rationale`
3. `Tradeoffs`
4. `Alternatives`
5. `When To Reconsider`
6. `Source References`

## Quality bar

- Use explicit causality: "because A, B".
- Keep tradeoffs concrete, not generic architecture slogans.
- Tie every principle claim to code evidence.
- If intent is unclear, mark it as inference, not fact.

