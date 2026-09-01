/**
 * PROJ-DOC-REMOVE — document removal in the registration form must be keyed
 * by a stable per-file identity (objectPath), not by fileName.
 *
 * Two documents can share the same display file name (e.g. "report.pdf"
 * uploaded once under "Budget" and again under "Optional" — nothing
 * prevents this). removeDoc used to filter the whole documents array by
 * fileName alone, with no category/id scoping, so clicking delete on one
 * instance removed both from the form state.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/project-registration-form.tsx"), "utf8");

describe("PROJ-DOC-REMOVE — removeDoc is keyed by objectPath, not fileName", () => {
  it("filters the documents array by objectPath", () => {
    expect(src).toContain("const removeDoc = (objectPath: string) => {");
    expect(src).toContain("current.filter(d => d.objectPath !== objectPath)");
  });

  it("no longer filters by fileName alone", () => {
    expect(src).not.toContain("current.filter(d => d.fileName !== fileName)");
  });

  it("every call site passes the document's objectPath, not its fileName", () => {
    expect(src).toContain("onClick={() => removeDoc(doc.objectPath)}");
    expect(src).toContain("removeDoc(overrideDeleteDialog.objectPath)");
    expect(src).toContain("onClick={() => openOverrideDialog(doc.id!, doc.fileName, doc.objectPath)}");
  });
});
