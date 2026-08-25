# Document Management Navigation Alignment Audit

## Scope and result

The CAFA PMIS frontend navigation now presents one **Document Management**
split-link parent with one **File & Archive** child. The canonical File &
Archive workspace URL is:

`/document-management/file-archive`

The parent URL, `/document-management`, safely redirects to its only child so
the parent link remains useful in the expandable-sidebar convention.

The final translated breadcrumb at the canonical URL is:

`Home → Document Management → File & Archive`

The Administration navigation order is:

1. User Management (current visibility retained)
2. States (current visibility retained)
3. Audit Log (current visibility retained)
4. AI Assistant Settings (current visibility retained)
5. System Manual (current visibility retained)
6. Design System (current visibility retained)

## Compatibility and navigation consumers

- `/files` is a one-way frontend redirect to the canonical workspace.
- `/drive` and `/program-resources` remain one-way compatibility redirects.
- Legacy redirects retain only the pre-existing safe list context: their
  source marker plus bounded `search` and `status` values. Unsupported query
  keys are dropped.
- The File & Archive workspace consumes the same route-context parser as the
  redirects, so retained values initialise the actual search, source, and
  status filters rather than only appearing in the canonical URL.
- The command palette, recent-page metadata, and notification safe-route
  allow-list use the canonical Document Management destination. Legacy paths
  remain only for compatibility redirects.
- English and Arabic include translated Document Management and File & Archive
  navigation labels. Obsolete navigation and command-palette copy for
  “SOPs & Resources” and “Document Repository” has been removed.

## Explicitly out of scope

No backend routes, APIs, permissions, database records, migrations, storage
behaviour, document data, or File & Archive page behaviour were changed.
User Management, States, System Manual content, and unrelated attachments,
project, report, risk, and communication navigation remain unchanged.

## Verification evidence

The navigation regression suite includes DOC-NAV-01 through DOC-NAV-09:

- canonical route and safe parent redirect
- `/files`, `/drive`, and `/program-resources` compatibility redirects
- single Document Management parent and single File & Archive child
- no standalone File & Archive link in Knowledge & Support
- canonical command-palette destination
- approved Administration ordering
- translated labels and obsolete-label removal
- canonical breadcrumb metadata
- preserved File & Archive page-surface assertions

The following commands completed successfully after the final redirect fix:

```sh
pnpm --filter @workspace/cafa-pmis run typecheck
pnpm --filter @workspace/cafa-pmis exec vitest run src/test/files-archive-navigation.test.ts src/test/i18n-shell.test.ts
pnpm --filter @workspace/cafa-pmis run build
```

Results:

- TypeScript check: passed.
- Navigation and i18n regressions: passed, 2 files / 95 tests. This includes
  direct behavioural assertions that each legacy redirect produces canonical
  URL context which the workspace parser converts into its search, source, and
  status filters.
- Production build: passed. Existing source-map resolution and chunk-size
  warnings were emitted, but no build failure occurred.
- Browser verification: passed. The canonical page rendered with the required
  breadcrumb and sidebar hierarchy. `/files?search=policy` retained `search`
  while dropping unsupported keys and populating the visible search field plus
  file-list request. `/drive` and `/program-resources` retained only their
  approved context, populated the matching visible source/filter state, and
  did not loop.

## Residuals

None identified. Legacy URLs intentionally remain redirect-only for safe
bookmarks and existing frontend links.