---
name: risk-review-skill
description: Identify concrete bugs, edge cases, and maintenance risks in selected code, then rank by impact and likelihood. Use this whenever users ask for risk review, bug hunt, 风险分析, edge case review, 隐患排查, or reliability concerns.
---

# Risk Review Skill

Use this skill to produce actionable engineering risk analysis.

## Core goals

1. Find concrete failure modes, not abstract fear.
2. Rank risks by impact and likelihood.
3. Provide mitigation guidance tied to code change points.

## Workflow

1. Scan risk-heavy constructs first.
   - Branching, null/undefined handling, throw/catch, async/concurrency, boundary parsing, external IO.
2. Build risk items.
   - For each risk, define condition -> failure -> impact.
3. Rank each item.
   - Severity: Critical/High/Medium/Low.
   - Likelihood: High/Medium/Low.
4. Recommend mitigations.
   - Preventive fix, detection guardrail, and test coverage suggestion.
5. Call out uncertainty.
   - Mark assumptions due to missing runtime context or unseen modules.

## Output structure

ALWAYS include:


1. `Risk Register`
2. `Top Priorities`
3. `Mitigations`
4. `Testing Focus`
5. `Uncertainty`
6. `Source References`

For each risk item, use this compact schema:

`[Severity | Likelihood] Condition -> Failure -> Impact`

## Quality bar

- Prefer specific, reproducible risks over broad warnings.
- Do not report style nits as risk unless they can cause failures.
- Rank risks explicitly and justify ranking.
- Keep remediation practical and code-location oriented.

