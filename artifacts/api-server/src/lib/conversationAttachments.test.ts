import { describe, expect, it } from "vitest";
import {
  conversationAttachmentAt,
  publicConversationAttachments,
} from "./conversationAttachments";

describe("conversation attachment availability", () => {
  const stored = [{
    name: "legacy.pdf",
    type: "file",
    objectPath: "/objects/uploads/legacy.pdf",
    contentType: "application/pdf",
    size: 42,
    availabilityStatus: "unavailable",
  }];

  it("preserves the unavailable state for the parent-authorised proxy guard", () => {
    expect(conversationAttachmentAt(stored, 0)).toMatchObject({
      objectPath: "/objects/uploads/legacy.pdf",
      availabilityStatus: "unavailable",
    });
  });

  it("exposes only the redacted unavailable state to message clients", () => {
    const attachments = publicConversationAttachments(7, 9, stored);
    expect(attachments).toEqual([expect.objectContaining({
      availabilityStatus: "unavailable",
      url: "/api/conversations/7/messages/9/attachments/0",
    })]);
    expect(attachments[0]).not.toHaveProperty("objectPath");
  });
});