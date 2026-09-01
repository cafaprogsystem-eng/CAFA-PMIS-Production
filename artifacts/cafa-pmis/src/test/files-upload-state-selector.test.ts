/**
 * FILES-UPLOAD-STATE-SELECTOR — the File & Archive upload dialog now offers
 * an optional "Associated State" selector for direct-upload resources. When
 * set, a State Program Officer for that state can view the resource even
 * when its confidentiality is Confidential/Restricted (see the backend's
 * FILES-CONFIDENTIALITY-GATE fix); when left unset, a confidential/restricted
 * resource stays scoped to its uploader + archive managers only, exactly as
 * before.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/files.tsx"), "utf8");

describe("FILES-UPLOAD-STATE-SELECTOR: UploadDialog offers an optional state selector", () => {
  it("declares stateId state and fetches the states list", () => {
    expect(src).toContain('const [stateId, setStateId] = useState("");');
    expect(src).toContain('queryKey: ["states-list"]');
    expect(src).toContain('await fetch("/api/states"');
  });

  it("sends stateId in the upload payload only when a real state is selected", () => {
    expect(src).toContain("stateId: stateId ? Number(stateId) : undefined,");
  });

  it("resets stateId after a successful upload", () => {
    expect(src).toContain("setStateId(\"\");");
  });

  it("renders a Select with a no-specific-state default option", () => {
    const dialogBlock = src.slice(src.indexOf("function UploadDialog"), src.indexOf("function DetailDialog"));
    expect(dialogBlock).toContain('id="archive-state"');
    expect(dialogBlock).toContain('{t("fileArchive.noSpecificState")}');
    expect(dialogBlock).toContain('{t("fileArchive.stateHint")}');
  });
});

describe("FILES-UPLOAD-STATE-SELECTOR: ArchiveItem carries the new fields end-to-end", () => {
  it("the ArchiveItem type declares stateId/stateName/stateNameAr", () => {
    const typeBlock = src.slice(src.indexOf("export type ArchiveItem"), src.indexOf("type FileList"));
    expect(typeBlock).toContain("stateId: number | null;");
    expect(typeBlock).toContain("stateName: string | null;");
    expect(typeBlock).toContain("stateNameAr: string | null;");
  });

  it("DetailDialog shows the associated state only when one is set", () => {
    const detailBlock = src.slice(src.indexOf("function DetailDialog"), src.indexOf("function ReplaceDialog"));
    expect(detailBlock).toContain("item.stateId != null &&");
    expect(detailBlock).toContain("getLinkedStateLabel(item, i18n.language)");
  });
});
