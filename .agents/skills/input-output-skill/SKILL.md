---
name: input-output-skill
description: Explain input/output contracts, parameter expectations, return values, and side effects for selected code. Use this whenever users ask about input, output, I/O, 入参, 返回值, 参数, 输入输出, or contract details.
---

# Input / Output Skill

Use this skill to describe what data goes in, what comes out, and what side effects happen.

## Core goals

1. Clarify input constraints and assumptions.
2. Clarify output structure and semantics.
3. Highlight side effects and error contracts.

## Workflow

1. Extract input surface.
   - Parameters, context usage, and required preconditions.
2. Extract output surface.
   - Return values, mutations, and emitted events.
3. Capture exceptional paths.
   - Error conditions and fallback values.
4. Mark uncertainty.
   - Explicitly state missing contract evidence.

## Output structure

Prefer concise contract bullets:

- Inputs
- Outputs
- Side effects
- Error conditions
- Source references

