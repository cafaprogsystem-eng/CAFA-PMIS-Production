---
name: Wouter shared new/edit route
description: When a detail page handles both create and edit, route only `/resource/:id` (with `id === "new"` as the create sentinel) — never add a sibling `/resource/new` route.
---

When one component handles both create and edit on the same page, register a single wouter route `/resource/:id` and treat `id === "new"` as the create-mode sentinel. Do NOT also register `/resource/new` as a dedicated route.

**Why:** wouter matches routes in declaration order. A sibling `/resource/new` route mounts the component without the `:id` route param, so the page's `params.id === "new"` check is `undefined === "new"` (false) — it enters edit mode, fires `GET /resource/NaN`, and Save cannot create. This burned us in the Planning module before fix.

**How to apply:** In `App.tsx`, declare only `<Route path="/resource/:id" component={Detail} />`. Inside the page, branch with `const isNew = params.id === "new"`. The same `useParams()` hook then drives both flows. If you want a tidier URL than `/resource/new`, use a query param (`/resource/:id?type=action`) — still keep the single route.
