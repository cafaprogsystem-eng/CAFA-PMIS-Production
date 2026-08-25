# File & Archive Classification & Upload Refinement Audit

## 1. Scope

This targeted refinement keeps the approved File & Archive workspace structure:
header, three summary metrics, classification navigation, filters, registry, and
pagination. It does not introduce a new archive table, new metadata fields,
direct storage URLs, or parent-module attachment workflows.

## 2. Reference Screenshot Interpretation

The reference was interpreted as a dense enterprise workspace pattern rather
than a new document taxonomy. The desktop classification panel is compact and
persistent, while the generic upload surface remains limited to the one field
the existing contract truthfully accepts: a file.

## 3. Classification Taxonomy Source

The archive aggregate retains the source-preserving projection of
`program_resources` and `drive_files`. It provides:

- the six established Program Resources categories in their canonical product
  order, including zero-count categories when the user may view resources; and
- only classifications discovered from authorised source records for everything
  outside that taxonomy.

No reference-only humanitarian, departmental, confidentiality, or arbitrary
categories are invented.

## 4. Classification Rail

Desktop uses a narrow, locally scrolling Classifications rail. All Documents is
first and Archived is second. Rows use semantic Lucide icons, compact
36-pixel-height controls, primary selected styling, keyboard focus rings,
safe one-line truncation with a full-value title, and a fixed trailing
tabular-number region.

The lifecycle controls remain views rather than fabricated classifications.
Active and deleted lifecycle choices remain in the existing filter control.

## 5. Counts

The classification endpoint calculates its counts from the authorised
source projection before registry pagination. It returns full source-scoped
All Documents and Archived totals, plus counts for the current lifecycle/source
scope. The client never derives these values from the visible table page.

## 6. Responsive Classification Behaviour

The desktop rail is hidden below the large layout breakpoint. A labelled mobile
Classification selector exposes the same All Documents, Archived, and
authoritative category options. This avoids a cramped horizontal rail while
keeping category choices equivalent across viewport sizes.

Classification, source, lifecycle, and search remain URL-backed. Selecting a
classification preserves the current search, source, and lifecycle filters;
the helper serialises only bounded, allowed query values. Browser refreshes,
deep links, and back/forward therefore reproduce the selected archive view.

## 7. Upload Document CTA

The header retains one permission-aware Upload Document CTA. It is not rendered
for users without the established `documents.upload` or
`program_resources.upload` capability; the server remains authoritative.

## 8. Upload Dialog

The responsive dialog uses the existing direct file-picker upload contract.
It provides a labelled picker, concise generic archive copy, and a selected
file summary with safe filename, MIME type, size, Change, and named Remove
actions. The dialog deliberately has no title, classification, department,
confidentiality, tags, or related-entity controls because the generic upload
endpoint does not support them.

## 9. Validation / Error / Success

The upload is single-submit while pending and blocks dismissal during the
request. Server-backed missing-file, file-size, blocked-type, permission, and
generic failures render beside the control without discarding the selected
file. Multer size/type failures are normalised to safe archive error codes.

On success the dialog resets and invalidates every `files` query family,
refetching the registry, summary metrics, and classification aggregate instead
of patching counts locally.

## 10. Permission / Security Preservation

The original source-of-truth projection, canonical parent scope predicates,
download/preview proxies, version history, lifecycle eligibility flag, and
parent-owned Drive attachment controls are unchanged. Aggregate counts use the
same authorised projection as listing data. Public DTOs still expose proxy URLs
only and do not return object paths, provider URLs, or storage keys.

## 11. Arabic / RTL

English and Arabic now cover the changed upload title, picker actions, selected
file type, pending state, and contextual validation errors. The rail and
dialog continue to use logical layout classes, preserving the application RTL
direction treatment.

## 12. Accessibility

Rail rows are native buttons with pressed state and visible keyboard focus.
Counts are hidden from assistive labels to avoid ambiguous announcements.
The mobile selector is labelled. The actual file input, not merely its trigger,
is associated with the File label. Selected-file and pending/error states use
appropriate live regions, and the remove action includes the selected filename.

## 13. Tests

Completed:

```sh
pnpm --filter @workspace/cafa-pmis exec vitest run \
  src/test/files-archive-navigation.test.ts \
  src/test/i18n-shell.test.ts \
  src/test/i18n-glossary.test.ts

pnpm --filter @workspace/api-server exec vitest run \
  src/routes/files-contract.test.ts
```

Results:

- Frontend archive/navigation and i18n regressions: **160 passed**.
- Backend archive contract regressions: **4 passed**.
- FILE-CLASS-VIS and FILE-UPLOAD-VIS sentinels cover taxonomy baseline,
  permission-scoped aggregate behaviour, URL/filter intersection, responsive
  selector parity, upload dialog state, safe supported metadata, pending/error
  handling, and refetch invalidation.

## 14. TypeScript / Build

```sh
pnpm --filter @workspace/cafa-pmis run build
git diff --check
```

The production Vite build passed. Existing source-map and chunk-size warnings
did not fail it. The web and API workflows restarted cleanly.

The project-wide web typecheck remains blocked by eight pre-existing State
Administration API-client errors in `state-detail.tsx` and `states.tsx`; the
API typecheck remains blocked by pre-existing object-storage and
plans-aggregate integration test errors. Neither command reports a File &
Archive-owned error.

## 15. Browser Verification

The application and API were restarted successfully and the unauthenticated
preview loaded the login screen cleanly. A non-mutating browser test attempted
desktop, mobile, and Arabic/RTL archive validation but was blocked because no
authenticated browser session was available: `/document-management/file-archive`
redirected to `/login` and `/api/me` returned 401. No credentials were guessed
and no archive data was changed.

## 16. Residual Register

- Authenticated desktop, mobile, and Arabic visual checks require an existing
  safe authenticated browser session. This is an environment limitation, not a
  bypassable product failure; automated targeted coverage, build, runtime
  startup, and security contract checks completed successfully.