# Communication Centre Historical Data Reconciliation Register

## Purpose

This register records development-database findings observed during the read-only
preflight for Communication Centre lifecycle and integrity hardening. It is not
a remediation script and must not be used to merge rooms, delete memberships,
delete messages, or delete stored objects automatically.

No message body, attachment path, sender display name, or other private message
content is included.

## Preflight result

| Classification | Development IDs / count | Required human decision |
|---|---:|---|
| Duplicate membership rows | Conversation/user pairs `(1,4)` rows `54,71`; `(2,8)` rows `51,52`; `(7,4)` rows `16,17` | Confirm which duplicate membership rows may be consolidated before a global membership uniqueness constraint is validated. |
| Malformed Direct rooms | Conversations `1` (members `1,2,3,4`) and `7` (members `1,3,4,6,8,9`) | Decide whether either room has a valid product owner and how its historical participants should be represented. They must not be treated as canonical pairwise DMs. |
| Duplicate organisational room | Sector `WASH`, conversations `5,8` | Select the canonical room. Do not merge histories automatically. |
| Orphan memberships | `69` rows: membership IDs `72,73` and `91–157` | Identify the missing parent reference for each row, then approve a data repair plan. |
| Orphan message references | Message IDs `56,57,75,76,85,86` | Determine whether each missing conversation, sender, reply, or forward reference should be repaired or retained as legacy evidence. |
| Unbound project room | Conversation `3` | Assign a valid project only with confirmed business ownership, or archive through an approved process. |

## Software protection already applied

- New message hides use `message_user_hides`, so Delete For Me is private to
  the actor and cannot rewrite shared content or attachment visibility.
- New Direct, Project, State, and Sector conversation creation uses a
  transaction-scoped database advisory lock and canonical key table.
- New membership adds use a transaction-scoped database advisory lock and
  idempotent existence check.
- New parent references are protected by tracked forward-enforcing foreign
  keys. They are intentionally `NOT VALID` until historical reconciliation is
  approved.

## Explicitly out of scope

- Object deletion and orphan-upload cleanup remain governed by COMM-BD-004.
- No historical conversation, membership, message, or stored object was
  mutated by the preflight or migration.