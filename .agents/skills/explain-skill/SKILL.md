---
name: explain-skill
description: Explain selected code behavior step by step with concrete evidence. Use this whenever a user asks "explain", "what does this do", "做什么", "解释这段代码", "看懂这段逻辑", or any equivalent request, even if they do not explicitly mention "explain".
---

# Explain Skill

Use this skill to reconstruct code behavior clearly and concretely for code-reading tasks.

## Core goals

1. Reconstruct what the code actually does in runtime order.
2. Keep explanations grounded in observable code evidence.
3. Separate confirmed facts from inference and uncertainty.

## Workflow

1. Confirm scope first.
   - Identify file, function, and range the user is asking about.
   - If scope is ambiguous, infer the most likely active symbol and state the assumption.
2. Rebuild behavior in order.
   - Describe input assumptions, control flow, branches, and outputs.
   - Explicitly mention branch conditions and what changes per branch.
3. Add minimal context.
   - Mention relevant caller/callee relationships only when they change behavior understanding.
4. Mark uncertainty.
   - If key implementation is missing, say what cannot be confirmed and why.

## Output structure

ALWAYS use this section order:

1. `Code Behavior` (main section, step-by-step)
2. `Principle` (brief, only if useful)
3. `Call Flow` (brief, only if useful)
4. `Risks` (brief, only concrete risks)
5. `Uncertainty`
6. `Source References`

## Quality bar

- Prefer concrete statements over vague summaries.
- Do not invent behavior that is not supported by code evidence.
- Use short causal language: "because X, Y happens".
- Keep the response practical for engineers reading unfamiliar code.

