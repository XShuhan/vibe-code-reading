---
name: call-flow-skill
description: Analyze callers, callees, and upstream/downstream handoff points for selected code. Use this whenever users ask about call flow, who calls what, caller/callee relationships, 上下游, 调用链, impact analysis, or where to trace next.
---

# Call Flow Skill

Use this skill to map execution relationships around a target symbol.

## Core goals

1. Identify upstream callers and downstream callees.
2. Explain data/control handoff between key nodes.
3. Show impact radius for changes to the target symbol.

## Workflow

1. Lock the target symbol.
   - Resolve function/class/module in focus.
2. Map upstream first.
   - List who invokes the target and from where.
   - Distinguish direct vs indirect callers when possible.
3. Map downstream next.
   - List key functions/components called by the target.
   - Highlight side-effect points (IO, network, state mutation, persistence).
4. Explain handoff.
   - For each important edge, describe what is passed and why it matters.
5. Mark unknown edges.
   - Explicitly note dynamic dispatch/reflection/runtime wiring gaps.

## Output structure

ALWAYS include:

1. `Question Restatement`
2. `Conclusion`
3. `Call Flow`
4. `Upstream`
5. `Downstream`
6. `Impact Analysis`
7. `Uncertainty`
8. `Source References`

In `Call Flow`, include at least one arrow chain like:

`Entry -> Target -> Dependency -> Side Effect`

## Quality bar

- Explicitly label upstream and downstream.
- Prefer small, readable chains over giant unreadable trees.
- Do not claim a caller/callee relationship without evidence.
- If evidence is partial, state confidence level and missing links.

