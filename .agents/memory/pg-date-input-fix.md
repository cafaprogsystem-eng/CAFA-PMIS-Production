---
name: PG date columns in HTML date inputs
description: API serialises PG date columns as full ISO strings; date inputs need YYYY-MM-DD only — always slice(0,10).
---

## Rule
When a PG `date` column value (e.g. `start_date`, `end_date`) is used to populate an HTML `<input type="date">`, always slice to 10 characters first.

```ts
startDate: existing.startDate ? String(existing.startDate).slice(0, 10) : "",
```

**Why:** PG `date` columns serialised through JSON become full ISO datetime strings like `"2026-07-01T00:00:00.000Z"`. An HTML date input with this value cannot parse the time component and displays blank — this was the root cause of blank Start/End Dates on the Plan Details approved plan page.

**How to apply:** Any time you copy an API-returned date value into a form state field for a `type="date"` input, apply `.slice(0, 10)`. In view mode, pass the sliced value to `formatDate()` for readable display.

**Related:** `pg-date-types.md` covers the `::date` cast producing JS Date objects in raw pg queries; this issue is the JSON-serialised variant of the same class of defect.
