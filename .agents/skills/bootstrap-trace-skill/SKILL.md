---
name: bootstrap-trace-skill
description: Trace startup entry files and bootstrap initialization path with concrete file and symbol grounding. Use this whenever generating startupEntry or startupFlow for project overview output.
---

# Bootstrap Trace Skill

Use this skill to map how the project starts.

## Core goals

1. Identify the strongest startup entry candidate from available evidence.
2. Reconstruct bootstrap steps in execution order until the app is ready.
3. Ground each startup step in specific files and symbols.

## Workflow

1. Rank entry candidates.
   - Prefer executable entry files explicitly listed in dossier signals.
2. Build startup sequence.
   - Capture only initialization/bootstrap actions, not steady-state runtime loops.
3. Attach evidence per step.
   - Include path-level grounding and explain why each step matters.
4. State ambiguity.
   - If multiple entries are plausible, pick the strongest and explain uncertainty.

## Quality bar

- Keep startupFlow chronological and initialization-scoped.
- Avoid mixing runtime request handling into bootstrap steps.
- Prefer strong visible candidates over speculative entry points.
