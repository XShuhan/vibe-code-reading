---
name: module-summary-skill
description: Summarize module responsibilities, boundaries, public surface, and dependency relationships for onboarding and code-reading. Use this whenever users ask for module summary, 模块职责, boundary analysis, architecture overview, ownership mapping, or TL;DR of a code area.
---

# Module Summary Skill

Use this skill to create high-signal module overviews for readers new to a code area.

## Core goals

1. Clarify what the module owns and what it does not own.
2. Explain public surface and major internal parts.
3. Map dependencies and boundary contracts.

## Workflow

1. Determine module scope.
   - Directory/file set included in "this module".
2. Identify public surface.
   - Exports, interfaces, entry points, extension points.
3. Summarize responsibilities.
   - Primary responsibilities first, secondary responsibilities second.
4. Explain boundaries.
   - Upstream dependencies, downstream consumers, and cross-module contracts.
5. Add maintenance hints.
   - "Edit here for X" guidance and common change paths.

## Output structure

Use this section order:

1. `TL;DR`
2. `Module Responsibilities`
3. `Public Surface`
4. `Internal Structure`
5. `Boundaries and Dependencies`
6. `Typical Change Scenarios`
7. `Uncertainty`
8. `Source References`

## Quality bar

- Be explicit about ownership boundaries.
- Distinguish exported API from internal implementation details.
- Keep summary concise but operationally useful for maintainers.
- If scope is fuzzy, state assumptions up front.

