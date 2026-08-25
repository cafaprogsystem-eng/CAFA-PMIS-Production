import { describe, expect, it, vi } from "vitest";
import {
  canUploadMessageAttachments,
  uploadMessageAttachment,
} from "./message-upload";

function descriptorFor(name: string, contentType: string, size: number) {
  return {
    uploadURL: "https://storage.example.test/private-upload",
    objectPath: "/objects/uploads/message-file",
    uploadToken: "signed-message-descriptor",
    metadata: { name, contentType, size, scope: "messages" as const },
  };
}

describe("Communication Centre upload transport", () => {
  it.each([
    ["image", "image/jpeg", "photo.jpg"],
    ["file", "application/pdf", "brief.pdf"],
    ["voice", "audio/webm", "voice.webm"],
  ] as const)("uses the canonical descriptor for a %s upload", async (type, contentType, name) => {
    const blob = new Blob(["message attachment"], { type: contentType });
    const descriptor = descriptorFor(name, contentType, blob.size);
    const requestUploadUrl = vi.fn().mockResolvedValue(descriptor);
    const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const attachment = await uploadMessageAttachment({
      blob,
      name,
      contentType,
      type,
      ...(type === "voice" ? { duration: 12 } : {}),
      requestUploadUrl,
      fetchImplementation: put,
    });

    expect(requestUploadUrl).toHaveBeenCalledWith({
      name,
      size: blob.size,
      contentType,
      scope: "messages",
    });
    expect(put).toHaveBeenCalledWith(descriptor.uploadURL, expect.objectContaining({
      method: "PUT",
      body: blob,
      headers: { "Content-Type": contentType },
    }));
    expect(attachment).toMatchObject({
      name,
      type,
      objectPath: descriptor.objectPath,
      contentType,
      size: blob.size,
      uploadToken: descriptor.uploadToken,
    });
    expect(attachment).not.toHaveProperty("uploadUrl");
  });

  it("fails before a message can reference a rejected byte upload", async () => {
    const blob = new Blob(["x"], { type: "audio/webm" });
    await expect(uploadMessageAttachment({
      blob,
      name: "voice.webm",
      contentType: "audio/webm",
      type: "voice",
      requestUploadUrl: vi.fn().mockResolvedValue(descriptorFor("voice.webm", "audio/webm", blob.size)),
      fetchImplementation: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    })).rejects.toThrow("message_upload_failed");
  });

  it("allows an explicit fresh retry after an interrupted PUT without returning a failed attachment", async () => {
    const blob = new Blob(["retry"], { type: "application/pdf" });
    const requestUploadUrl = vi
      .fn()
      .mockResolvedValueOnce(descriptorFor("retry.pdf", "application/pdf", blob.size))
      .mockResolvedValueOnce({
        ...descriptorFor("retry.pdf", "application/pdf", blob.size),
        objectPath: "/objects/uploads/retry-file",
        uploadToken: "fresh-signed-message-descriptor",
      });
    const put = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(uploadMessageAttachment({
      blob, name: "retry.pdf", contentType: "application/pdf", type: "file", requestUploadUrl, fetchImplementation: put,
    })).rejects.toThrow("message_upload_failed");

    const attachment = await uploadMessageAttachment({
      blob, name: "retry.pdf", contentType: "application/pdf", type: "file", requestUploadUrl, fetchImplementation: put,
    });

    expect(requestUploadUrl).toHaveBeenCalledTimes(2);
    expect(attachment).toMatchObject({
      objectPath: "/objects/uploads/retry-file",
      uploadToken: "fresh-signed-message-descriptor",
    });
  });

  it("uses server-canonical filename and MIME metadata when sending", async () => {
    const blob = new Blob(["voice"], { type: "audio/webm;codecs=opus" });
    const descriptor = descriptorFor("voice.webm", "audio/webm", blob.size);
    const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const attachment = await uploadMessageAttachment({
      blob,
      name: " voice.webm ",
      contentType: "audio/webm;codecs=opus",
      type: "voice",
      requestUploadUrl: vi.fn().mockResolvedValue(descriptor),
      fetchImplementation: put,
    });

    expect(put).toHaveBeenCalledWith(descriptor.uploadURL, expect.objectContaining({
      headers: { "Content-Type": "audio/webm" },
    }));
    expect(attachment).toMatchObject({
      name: "voice.webm",
      contentType: "audio/webm",
      size: blob.size,
    });
  });

  it("only enables upload controls for the dedicated capability", () => {
    expect(canUploadMessageAttachments([])).toBe(false);
    expect(canUploadMessageAttachments(["messages.send"])).toBe(false);
    expect(canUploadMessageAttachments(["messages.attachments.upload"])).toBe(true);
    expect(canUploadMessageAttachments(["*"])).toBe(true);
  });
});