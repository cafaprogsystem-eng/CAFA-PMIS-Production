---
name: Public routes must wrap outside AuthGate
description: How to add an unauthenticated page (e.g. invite acceptance, password reset) without it getting bounced to the login page.
---

The web app gates everything through `AuthGate` in `artifacts/cafa-pmis/src/App.tsx` — if `/api/me` returns 401, the user sees `LoginPage`. A public-by-design page (no session yet) must be matched **above** AuthGate, or it will be hidden behind the login wall.

**How to apply:**

1. In `App.tsx`, wrap routes in a wouter `<Switch>` and put public `<Route>` entries before the catch-all that renders `<AuthGate />`:
   ```tsx
   <Switch>
     <Route path="/invite/:token" component={InviteAcceptPage} />
     <Route><AuthGate /></Route>
   </Switch>
   ```
2. On the server, add the same path to `PUBLIC_PATHS` in `artifacts/api-server/src/middlewares/currentUser.ts` so the matching API endpoints don't require a session cookie. Prefix matches use `startsWith`; exact matches are in the set.

**Why:** AuthGate runs a blocking `useQuery` to `/api/me`. Without the outer Switch, even a public route renders the login screen on first load when there's no session, which is wrong for activation/recovery flows where the user has no credentials yet by definition.
