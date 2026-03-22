---
name: concurrency-state-skill
description: Explain async execution, shared state transitions, and race-condition risks in selected logic. Use this whenever users ask about concurrency, threads, async/await, race, state consistency, 并发, 线程, 锁, or 竞态.
---

# Concurrency / State Skill

Use this skill to map ordering and state consistency behavior.

## Core goals

1. Identify async boundaries and ordering assumptions.
2. Track shared-state updates and invariants.
3. Surface concrete race and consistency risks.

## Workflow

1. Mark async entry/exit points.
2. Trace state read/write sequence.
3. Highlight missing guards, idempotency gaps, and retry hazards.
4. State uncertainty for runtime wiring not visible in evidence.

## Output structure

Include:

1. Async timeline
2. State transition notes
3. Race/consistency risks
4. Mitigation hints
5. Source references

