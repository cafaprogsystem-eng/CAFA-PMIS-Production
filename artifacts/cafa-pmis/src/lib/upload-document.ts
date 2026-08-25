/**
 * PRJ-BD-04: Two-phase document upload helper.
 *
 * Performs the storage PUT before posting metadata so a storage failure
 * cannot produce a phantom document record. Tested directly in unit tests.
 */

export type UploadDocumentMetadata = {
  category: string;
  kind: string;
  contentType: string;
  size: number;
};

export type UploadDocumentResult =
  | { ok: true; data: unknown }
  | { ok: false; error: "storage_put_failed" | string };

/**
 * Uploads a file to storage (PUT) and, only on success, posts the metadata
 * to the document API (POST). Returns a discriminated-union result so callers
 * can handle each failure path without exceptions.
 */
export async function uploadDocumentFile(
  projectId: number,
  file: File,
  uploadURL: string,
  objectPath: string,
  metadata: UploadDocumentMetadata,
): Promise<UploadDocumentResult> {
  // Phase 1 — storage PUT; abort if rejected to prevent phantom records
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!putRes.ok) {
    return { ok: false, error: "storage_put_failed" };
  }

  // Phase 2 — metadata POST (only reached when PUT succeeded)
  const postRes = await fetch(`/api/projects/${projectId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: metadata.category,
      kind: metadata.kind,
      fileName: file.name,
      contentType: metadata.contentType,
      size: metadata.size,
      objectPath,
    }),
  });

  if (!postRes.ok) {
    const body = (await postRes.json().catch(() => ({}))) as { message?: string; error?: string };
    return { ok: false, error: body.message ?? body.error ?? "metadata_post_failed" };
  }

  return { ok: true, data: await postRes.json() };
}
