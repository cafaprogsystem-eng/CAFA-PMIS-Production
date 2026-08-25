---
name: CurrentUser shape from useGetMe
description: The return type of useGetMe() wraps user inside { user, permissions } — accessing .role directly causes a TS2339 error.
---

The generated `useGetMe()` hook returns `CurrentUser`, defined in OpenAPI as:

```
CurrentUser:
  user: User   ← role lives here
  permissions: string[]
```

**Why:** The API was designed to separate the user record from the computed permission list. `me?.role` fails at compile time — the `role` field is on the nested `user` object.

**How to apply:** Always access `me?.user.role` (not `me?.role`) when checking the current user's role in any React component. Use `me?.permissions` for permission checks (or the `hasPerm()` helper in `lib/format.ts`).
