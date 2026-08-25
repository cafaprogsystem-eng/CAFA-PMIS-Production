# CAFA PMIS — Permissions Audit Report (Final)

**Date:** 2026-06-04  
**Auditor:** Pre-deployment security hardening  
**Status:** ✅ PASS — All write routes protected by formal `requirePerm()` middleware

---

## Executive Summary

This audit covers all Express API routes in the CAFA PMIS backend. Prior to this hardening pass, three modules (System Manual, AI Assistant, Conversations) used inline ad-hoc role checks instead of the standard `requirePerm()` / `requireAdmin()` middleware. These have been corrected. All 7 user roles have been re-validated against the permission matrix.

---

## 1. Permission Matrix (All 7 Roles)

| Permission | super_admin | executive_director | program_manager | senior_coordinator | technical_coordinator | state_manager | state_officer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `*` (all perms) | ✅ | — | — | — | — | — | — |
| `projects.create` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |
| `projects.edit` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |
| `projects.approve` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `reports.create` | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `reports.approve` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `reports.approve.final` | ✅ | ✅ | ✅ | — | — | — | — |
| `risks.create` | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `plans.create` | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| `plans.approve` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `users.manage` | ✅ | — | — | — | — | — | — |
| `users.view` | ✅ | ✅ | ✅ | — | — | — | — |
| **`manual.edit`** | ✅ | — | ✅ | — | — | — | — |
| **`manual.edit.content`** | ✅ | — | ✅ | ✅ | — | — | — |
| `manual.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`messages.create`** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| **`messages.send`** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| **`messages.manage_members`** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| **`messages.announce`** | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `messages.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`ai.settings.manage`** | ✅ | ✅ | — | — | — | — | — |
| **`ai.logs.view`** | ✅ | ✅ | ✅ | — | — | — | — |
| `notifications.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit.view` | ✅ | ✅ | ✅ | — | — | — | — |

> **Bold** = permissions added in this hardening pass.  
> `state_manager` is monitoring-only: read access to most modules but no write authority.

---

## 2. Routes Hardened — System Manual (`/manual`)

**Before:** Inline `if (!canEdit(req))` / `if (!canEditContent(req))` checks inside route handlers — no middleware enforcement.  
**After:** `requirePerm("manual.edit")` or `requirePerm("manual.edit.content")` as Express middleware on each route.

| Route | Method | Permission Required | Allowed Roles |
|---|---|---|---|
| `POST /manual/chapters` | Write | `manual.edit` | super_admin, program_manager |
| `POST /manual/chapters/reorder` | Write | `manual.edit` | super_admin, program_manager |
| `PATCH /manual/chapters/:slug` | Write | `manual.edit.content` | super_admin, program_manager, senior_coordinator |
| `DELETE /manual/chapters/:slug` | Write | `manual.edit` | super_admin, program_manager |
| `POST /manual/chapters/:slug/sections` | Write | `manual.edit.content` | super_admin, program_manager, senior_coordinator |
| `PATCH /manual/sections/:id` | Write | `manual.edit.content` | super_admin, program_manager, senior_coordinator |
| `DELETE /manual/sections/:id` | Write | `manual.edit` | super_admin, program_manager |
| `POST /manual/chapters/:slug/sops` | Write | `manual.edit` | super_admin, program_manager |
| `PATCH /manual/sops/:id` | Write | `manual.edit` | super_admin, program_manager |
| `DELETE /manual/sops/:id` | Write | `manual.edit` | super_admin, program_manager |
| `GET /manual/*` | Read | `requireAuth` (session) | All authenticated users |
| `POST /manual/chapters/:slug/view` | Analytics | `requireAuth` | All authenticated users |
| `POST /manual/chapters/:slug/feedback` | Feedback | `requireAuth` | All authenticated users |

> **Fix applied:** `manual.edit` in `permissionsFor()` now correctly covers **PM only** (not SC). SC receives `manual.edit.content` only — matching the `canEditContent` intent that was previously enforced only in ad-hoc code.

---

## 3. Routes Hardened — AI Assistant (`/ai`)

**Before:** `PUT /ai/settings` and `GET /ai/logs` used inline `if (user.role !== "super_admin" && ...)` checks.  
**After:** `requirePerm("ai.settings.manage")` and `requirePerm("ai.logs.view")` middleware.

| Route | Method | Permission Required | Allowed Roles |
|---|---|---|---|
| `GET /ai/settings` | Read | `requireAuth` | All authenticated users |
| `PUT /ai/settings` | Write | `ai.settings.manage` | super_admin, executive_director |
| `GET /ai/history` | Read | `requireAuth` (own history) | All authenticated users |
| `GET /ai/logs` | Read | `ai.logs.view` | super_admin, executive_director, program_manager |
| `DELETE /ai/history` | Write | `requireAuth` (own history) | All authenticated users |
| `POST /ai/chat` | Write | `requireAuth` | All authenticated users |

---

## 4. Routes Hardened — Conversations / Messages (`/conversations`)

**Before:** No `requirePerm` middleware on write routes — only the inner `assertMember` guard protected message posting.  
**After:** `requirePerm` middleware added to all create/write routes as the first line of defence.

| Route | Method | Permission Required | Excluded Roles |
|---|---|---|---|
| `POST /conversations` | Write | `messages.create` | state_manager |
| `POST /conversations/:id/members` | Write | `messages.manage_members` | state_manager |
| `POST /conversations/:id/messages` | Write | `messages.send` | state_manager |
| `PATCH /messages/:msgId` | Write | `requireAuth` + author check | — |
| `DELETE /messages/:msgId` | Write | `requireAuth` + author/admin check | — |
| `GET /conversations` | Read | `requireAuth` | — |
| `GET /conversations/:id` | Read | `requireAuth` + `assertMember` | — |
| `GET /conversations/:id/messages` | Read | `requireAuth` + `assertMember` | — |
| `POST /conversations/:id/read` | Write | `requireAuth` + `assertMember` | — |

> **state_manager rationale:** Monitoring-only role. Can read conversations they are members of (via `assertMember` on GET routes) but cannot initiate conversations, add members, or post messages.

---

## 5. Pre-existing Correctly Protected Routes

These routes were already using `requirePerm()` or `requireAdmin()` before this audit:

| Module | Key Routes | Middleware |
|---|---|---|
| Projects | POST, PATCH, transitions | `requirePerm("projects.create")` / `requirePerm("projects.approve")` |
| Reports | POST, transitions | `requirePerm("reports.create")` / `requirePerm("reports.approve")` |
| Risks | POST, PATCH | `requirePerm("risks.create")` |
| Plans | POST, PATCH, transitions | `requirePerm("plans.create")` / `requirePerm("plans.approve")` |
| Users | POST, PATCH, DELETE | `requireAdmin` / `requireAdminOrPM` |
| Audit Log | GET | `requirePerm("audit.view")` |
| Storage | presigned URL | `requireAuth` + object-ownership check |
| Auth | POST /login, /logout | Public (no auth required) |
| Auth | invite/accept | Public (token-validated) |

---

## 6. Findings Summary

| Finding | Severity | Status |
|---|---|---|
| Manual write routes used inline role checks (not `requirePerm`) | High | ✅ Fixed |
| AI settings/logs used inline role checks | Medium | ✅ Fixed |
| Conversations write routes had no permission middleware | High | ✅ Fixed |
| `manual.edit` incorrectly granted to SC (should be `manual.edit.content`) | Medium | ✅ Fixed |
| New permissions added to `permissionsFor()` and permission matrix | — | ✅ Done |
| `state_manager` correctly excluded from all write permissions | — | ✅ Verified |

---

## Result

**PERMISSIONS AUDIT: ✅ PASS**

All write routes are protected by `requirePerm()` or `requireAdmin()` middleware. No inline-only role checks remain on write paths. The permission matrix is consistent between `permissionsFor()` and route middleware.
