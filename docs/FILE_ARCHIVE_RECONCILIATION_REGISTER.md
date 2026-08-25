# Historical storage reconciliation policy

The reconciliation register is evidence, not a cleanup queue. Historical
records remain intact until an authorised owner makes a disposition or a
verified copy is finalised as a canonical attachment.

* **Import only proven sources.** The restricted importer checks the exact
  source key, byte count, MIME type, destination metadata, and a SHA-256
  evidence fingerprint.
* **Retry safely.** A legacy record and destination parent have one stable
  operation identity. A completed operation returns its existing attachment
  instead of copying bytes or creating another identity.
* **Fail closed.** Missing credentials, unavailable objects, metadata
  disagreement, a removed destination parent, or concurrent/uncertain state
  produces a reconciliation-required result. No automatic deletion follows.
* **Keep identifiers private.** Provider keys, signed URLs, and external file
  identifiers remain server-side evidence and never appear in the archive UI,
  reports, or API response payloads.