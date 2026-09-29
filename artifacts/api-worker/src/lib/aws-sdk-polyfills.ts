import { DOMParser, Node as XmlDomNode } from "@xmldom/xmldom";

/**
 * Side-effect-only module: registers the browser DOM globals the AWS SDK v3
 * needs to parse S3-compatible XML response bodies, which Workers doesn't
 * provide even under nodejs_compat. Shared by every module that talks to R2
 * via @aws-sdk/client-s3 (lib/storage.ts, lib/drive-storage.ts) so the fix
 * lives in one place instead of being duplicated per storage backend.
 *
 * DOMParser: without it, any request that gets back an XML body (e.g. a
 * HeadObjectCommand 404) throws "DOMParser is not defined" instead of the
 * SDK's own NotFound error.
 *
 * Node: some XML response shapes (confirmed: CopyObjectCommand's success
 * body, used by finalizeObjectEntityUpload/archiveFile) walk the parsed DOM
 * generically and reference the global `Node` constructor (e.g. its
 * ELEMENT_NODE/TEXT_NODE constants) — a second browser DOM global Workers
 * doesn't provide, needing the same polyfill treatment as DOMParser above.
 */
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === "undefined") {
  (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}
if (typeof (globalThis as { Node?: unknown }).Node === "undefined") {
  (globalThis as { Node?: unknown }).Node = XmlDomNode;
}
