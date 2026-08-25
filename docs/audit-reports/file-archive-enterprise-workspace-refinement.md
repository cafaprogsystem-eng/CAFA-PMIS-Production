# File & Archive Enterprise Workspace Refinement Audit

## Scope and outcome

The File & Archive workspace has been refined into a dense, permission-aware
CAFA data-management surface while keeping its canonical destination:

`/document-management/file-archive`

The former expandable **Document Management** sidebar item is retired. Users
with archive-read capability now see a non-interactive **DATA MANAGEMENT**
section label and a directly clickable **File & Archive** link. The section is
not rendered for users who cannot see the archive.

The existing compatibility redirects (`/document-management`, `/files`,
`/drive`, and `/program-resources`) still lead one way to the canonical page
and preserve only safe supported filter context. The command palette uses the
same archive-read capability. System Manual remains under Administration in its
existing order.

## Workspace behaviour

- The compact header has a permission-aware Upload Document control.
- Exactly three server-backed summary figures are shown: Total Documents,
  Active Documents, and Archived Documents.
- The desktop workspace combines a classification rail and dense registry;
  mobile uses compact document cards without page-level horizontal scrolling.
- The rail provides All Documents, Active Documents, Archived Documents, and
  canonical server-provided classifications. Classification counts are grouped
  only by the same selected source/lifecycle scope used by the registry; they
  are never derived from the loaded page.
- Search, existing source/status filters, archive lifecycle views, server-side
  page size, and server-page pagination are retained. An out-of-range page
  caused by a concurrent lifecycle change is clamped and reloaded before an
  empty state is shown.
- The registry uses only supplied document metadata: name, classification,
  version, date, lifecycle, size, and permitted actions. Long and absent values
  are bounded safely. No fabricated department, confidentiality, reference,
  tag, or other unsupported metadata is exposed.
- Loading, failure/retry, empty archive, empty active/archive lifecycle,
  empty classification, and filtered-empty states are distinct.

## Security and source authority

Preview/download proxy URLs, version history, archive upload, parent-scoped
listing, and resource lifecycle behaviour remain source-aware.

The central Drive archive lifecycle endpoint now enforces the same ownership
boundary as the interface: only an unlinked generic `attachments` upload may
be archived, restored, or deleted centrally. The list DTO supplies a
non-sensitive lifecycle-eligibility boolean calculated from both record and
project linkage, so the interface does not infer authority from an incomplete
visible parent reference. Project, report, plan, risk, and other parent-linked
files receive a 422 `lifecycle_managed_by_parent_module` response and their
lifecycle controls are not offered in the registry. This keeps a parent record
as the authority for its linked attachments.

## Localisation and accessibility

English and Arabic translations cover DATA MANAGEMENT navigation, the header,
summary figures, rail, filters, pagination, retry, upload, and all empty/error
messages. The page uses the application’s logical-direction utility classes.

The live browser checks confirmed:

- keyboard focus reaches the lifecycle rail controls;
- selected rail controls expose pressed state;
- icon-only document action triggers have descriptive labels;
- the semantic desktop table has labelled headers;
- the mobile surface does not introduce page-level horizontal scrolling;
- Arabic changes `html` and body direction to RTL and translates the File &
  Archive frame, rail, filters, pagination, and archived-empty message.

## Regression coverage

The targeted frontend archive/navigation suite now protects DATA-NAV-01 through
DATA-NAV-08 and FILE-VIS-01 through FILE-VIS-14, including canonical/legacy
navigation, permission checks, the direct link hierarchy, translated labels,
the exact three metric keys, rail controls, supported metadata restrictions,
server-pagination inputs, retry/empty states, responsive surfaces, and
out-of-range-page handling.

The backend archive contract suite continues to protect secure projection and
proxy endpoints, canonical parent scoping before counts/pagination, replacement
ownership boundaries, and the Drive lifecycle parent-authority boundary. The
frontend regression executes the lifecycle eligibility helper for the legacy
shape where an attachment has no record link but is project-linked, confirming
central controls stay hidden.

## Verification evidence

Completed:

```sh
pnpm --filter @workspace/cafa-pmis exec vitest run \
  src/test/files-archive-navigation.test.ts \
  src/test/i18n-shell.test.ts \
  src/test/i18n-glossary.test.ts

pnpm --filter @workspace/api-server exec vitest run \
  src/routes/files-contract.test.ts

pnpm --filter @workspace/cafa-pmis run build
git diff --check
```

Results:

- Frontend targeted regressions: **3 files, 159 tests passed**.
- Backend archive contract regression: **3 tests passed**.
- Production Vite build: **passed**. Existing source-map resolution and chunk
  size warnings were emitted without failing the build.
- Diff whitespace check: **passed**.
- Both API and web workflows were restarted and reported healthy startup.
- Authenticated browser checks passed for desktop, mobile (390px), and Arabic
  RTL. The browser session used the existing test account and did not mutate
  archive data. The mobile check measured `scrollWidth === clientWidth === 390`.

## Residuals

The project-wide frontend `tsc --noEmit` check remains blocked by eight
pre-existing API-client type errors in State Administration:

- `src/pages/state-detail.tsx`: `localitiesCount` is absent from `StateProfile`.
- `src/pages/states.tsx`: missing generated state create/update hooks and types,
  plus follow-on form/indexing and `officeAddress` type errors.

These errors are outside File & Archive and were present before this refinement.
They do not prevent the targeted archive suites or the production Vite build
from completing.