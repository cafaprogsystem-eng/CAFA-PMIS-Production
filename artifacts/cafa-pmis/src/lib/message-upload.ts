import type { UploadUrlRequest, UploadUrlResponse } from "@workspace/api-client-react";

export type MessageAttachmentKind = "image" | "file" | "voice";

export type UploadedMessageAttachment = {
  name: string;
  type: MessageAttachmentKind;
  url: string;
  objectPath: string;
  contentType: string;
  size: number;
  duration?: number;
  uploadToken: string;
};

type UploadUrlRequester = (request: UploadUrlRequest) => Promise<UploadUrlResponse>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function canUploadMessageAttachments(permissions: readonly string[] | undefined): boolean {
  return Boolean(
    permissions?.includes("*") ||
    permissions?.includes("messages.attachments.upload"),
  );
}

/**
 * Uses the generated upload descriptor contract for Communication Centre
 * uploads, then returns the private path solely for the subsequent message
 * create request. Message responses replace that path with an authorised proxy.
 */
export async function uploadMessageAttachment({
  blob,
  name,
  contentType,
  type,
  duration,
  requestUploadUrl,
  fetchImplementation = fetch,
}: {
  blob: Blob;
  name: string;
  contentType: string;
  type: MessageAttachmentKind;
  duration?: number;
  requestUploadUrl: UploadUrlRequester;
  fetchImplementation?: FetchImplementation;
}): Promise<UploadedMessageAttachment> {
  const upload = await requestUploadUrl({
    name,
    size: blob.size,
    contentType,
    scope: "messages",
  });
  if (!upload.uploadToken) {
    throw new Error("message_upload_descriptor_missing");
  }
  const metadata = upload.metadata;
  if (
    !metadata ||
    typeof metadata.name !== "string" ||
    typeof metadata.contentType !== "string" ||
    metadata.size !== blob.size
  ) {
    throw new Error("message_upload_descriptor_invalid");
  }
  const putResponse = await fetchImplementation(upload.uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": metadata.contentType },
  });
  if (!putResponse.ok) {
    throw new Error("message_upload_failed");
  }

  return {
    name: metadata.name,
    type,
    url: "",
    objectPath: upload.objectPath,
    contentType: metadata.contentType,
    size: metadata.size,
    uploadToken: upload.uploadToken,
    ...(duration === undefined ? {} : { duration }),
  };
}