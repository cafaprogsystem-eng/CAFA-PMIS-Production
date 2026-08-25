---
name: SPR comment section taxonomy
description: Canonical SPR reviewer-comment section keys — validation rule and read-access decision
---
Rule: comments on `report_type = "program_state"` must carry a canonical section key or null (null = "General / Report-Level"; whitespace-only input normalises to null); the server rejects unknown keys with 422 `invalid_section_key`. Other report/entity types accept arbitrary section strings.

**Why:** authors must see exactly which SPR section a reviewer flagged; free-text section tags drifted from the real form structure.

**How to apply:** the canonical key list must mirror sections actually rendered by the SPR form/detail — never add a key without a rendered counterpart. SPO/SOM have no comments.create, so reading reviewer feedback on a returned draft goes through a restricted read-only path gated by the canonical report-view check (state+sector scoped, fail-closed), never by widening comment permissions. Keep one shared comment stream; contextual "add comment" entry-points pre-seed the shared composer instead of creating inline boxes.
