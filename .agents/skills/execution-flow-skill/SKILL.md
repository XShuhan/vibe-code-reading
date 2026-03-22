---
name: execution-flow-skill
description: Build runtime execution flow from input to output with step linkage and flowchart-ready edges. Use this whenever generating executionFlow and flowDiagram fields in project overview output.
---

# Execution Flow Skill

Use this skill to describe the main runtime path after startup.

## Core goals

1. Describe the core runtime path from input/request to output/result.
2. Express flow as ordered nodes with explicit next-step links.
3. Keep flowchart edges consistent with executionFlow node ids.

## Workflow

1. Start after bootstrap.
   - Exclude pure startup initialization that belongs in startupFlow.
2. Build node sequence.
   - For each node, provide id, title, file, summary, and next links.
3. Validate link consistency.
   - Ensure every `next` id references an existing node id.
4. Emit flowchart.
   - Use Mermaid `flowchart TD` and map edges from executionFlow.

## Quality bar

- Prefer 4 to 6 concrete runtime steps when evidence supports it.
- Keep node summaries grounded in code paths, not architecture slogans.
- Return empty flow and diagram when runtime is indistinguishable from startup.
