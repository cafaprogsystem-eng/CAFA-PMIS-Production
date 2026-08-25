---
name: Object storage provider contract
description: Production storage standard and provider-selection rules for future storage changes
---

AWS S3 is the production storage standard. Production configuration uses
`STORAGE_PROVIDER=s3` with canonical `S3_BUCKET` and explicit `S3_REGION`;
`S3_ENDPOINT_URL` and prefix settings are optional. Credentials should resolve
through the AWS SDK default chain, preferably an attached IAM role.

**Why:** The application has supported alternate providers and legacy
configuration references, but production deployments need one unambiguous
contract and must fail before serving traffic instead of silently switching
providers.

**How to apply:** Keep GCS and Replit support conditional on the explicitly
selected provider. Never reintroduce `AWS_*` or GCS-only application mappings
as aliases for canonical S3 settings, and keep attachment authorization and
recovery controls parent/backend-owned.