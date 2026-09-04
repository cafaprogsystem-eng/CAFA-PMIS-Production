---
name: dockerfile-runner-script-copy-list
description: The Dockerfile's production runner stage copies scripts/*.mjs by an explicit file list, not the whole directory — a new one-off script is silently missing at runtime unless added there too.
---

# Dockerfile runner stage: `scripts/` is copied by explicit filename, not by directory

The production runner stage of the root `Dockerfile` does not `COPY --from=builder /app/scripts ./scripts`. Instead it lists each script the image needs by name in one `COPY` instruction:

```dockerfile
COPY --from=builder /app/scripts/package.json \
                    /app/scripts/migrate.mjs \
                    /app/scripts/seed.mjs \
                    /app/scripts/create-first-admin.mjs     ./scripts/
```

Any new one-off script added under `scripts/` (or referenced from there) that is meant to run inside the container — via `docker compose exec`, an ECS one-off Fargate task override, etc. — must be added to this list by hand. If it isn't, the script still builds and typechecks fine locally (nothing in the TypeScript/test pipeline checks the Dockerfile), but fails at container runtime with `Error: Cannot find module '/app/scripts/<name>.mjs'` — a `MODULE_NOT_FOUND` that only surfaces when the script is actually invoked against a real container/task, which can be well after the code was written and committed.

This has already happened twice with two different scripts:
- `scripts/capture-training-screenshots.mjs` (later deleted along with the whole training-video feature).
- `scripts/create-first-admin.mjs` (the one-off first-Super-Admin creation script for a brand-new production database — see `infra/aws-production/README.md`, "First administrator account").

Whenever a new script under `scripts/` needs to run inside the built image (production runner or the CI/AWS test of it), check this `COPY` line in the `Dockerfile` at the same time the script is added — don't rely on local `node build.mjs`/typecheck success as evidence the container will find it.
