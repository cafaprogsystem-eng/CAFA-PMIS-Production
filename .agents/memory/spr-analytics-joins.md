---
name: Report analytics join rule for project-less reports
description: Rule for scoping report analytics so project-less report types are not silently dropped
---
Some canonical report types intentionally have no project link (and one has no state link). Reaching sector scope through an INNER join or subquery on the projects table silently drops those rows from counts, approval queues, and activity feeds.

**Rule:** report analytics that should cover all report types must filter on the report's own sector first, falling back to the project's sector via an outer join; project-only metrics keep inner joins deliberately.

**Why:** inner-join sector scoping caused silent undercounts and missing approval-queue items for sector-scoped roles; sentinel tests now guard the boundary.

**How to apply:** when adding any dashboard/report aggregation, decide explicitly whether it is all-report or project-only, and never derive sector scope solely from the projects table for all-report metrics. Also: dynamically interpolated WHERE fragments must land after all JOIN clauses.
