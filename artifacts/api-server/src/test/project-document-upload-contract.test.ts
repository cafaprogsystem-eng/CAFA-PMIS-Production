import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routes = readFileSync(resolve(__dirname, "../routes/projects.ts"), "utf8");
const storage = readFileSync(resolve(__dirname, "../routes/storage.ts"), "utf8");
const form = readFileSync(
  resolve(__dirname, "../../../cafa-pmis/src/components/project-registration-form.tsx"),
  "utf8",
);

describe("project document upload provenance contract", () => {
  it("issues documents tokens with filename metadata", () => {
    expect(storage).toContain('scope: "documents"');
    expect(storage).toContain("fileName: safeName");
  });

  it("keeps the signed token in the form schema and upload result", () => {
    expect(form).toContain("uploadToken: z.string().optional()");
    expect(form).toContain("uploadToken: descriptor.uploadToken");
  });

  it("verifies ownership and every document metadata dimension before persistence", () => {
    expect(routes).toContain('descriptor.scope === "documents"');
    expect(routes).toContain("descriptor.userId === userId");
    expect(routes).toContain("descriptor.objectPath === document.objectPath");
    expect(routes).toContain("descriptor.fileName === document.fileName");
    expect(routes).toContain("descriptor.contentType === document.contentType");
    expect(routes).toContain("descriptor.maxSize === document.size");
    expect(routes).toContain("validProjectDocumentDescriptor(d, req.currentUser!.id)");
  });
});