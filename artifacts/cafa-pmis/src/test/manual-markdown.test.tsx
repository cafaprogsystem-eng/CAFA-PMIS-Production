/**
 * The System Manual renderer. Section content is editable by coordinators, so
 * it must never be injected as HTML (the old renderer used innerHTML with only
 * **bold** converted), and it must not drop text: the old numbered-list branch
 * lost a list's lead-in line, and tables and quotes showed as raw pipes/">".
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ManualMarkdown, parseManualMarkdown } from "@/lib/manual-markdown";

describe("MANUAL-MARKDOWN", () => {
  it("renders HTML in content as text, never as markup", () => {
    const { container } = render(
      <ManualMarkdown content={'Hello <img src=x onerror="alert(1)"> **<b>bold</b>**\n\n- <script>x()</script>'} emptyText="-" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("strong")).toHaveTextContent("<b>bold</b>");
  });

  it("keeps the lead-in line before a numbered list", () => {
    expect(parseManualMarkdown("Follow these steps:\n1. Open\n2. Save")).toEqual([
      { type: "paragraph", lines: ["Follow these steps:"] },
      { type: "numbered", items: ["Open", "Save"] },
    ]);
  });

  it("renders tables and quotes", () => {
    const { container } = render(
      <ManualMarkdown content={"| Step | Need |\n| --- | --- |\n| Basics | Project |\n\n> Every report has an approval path."} emptyText="-" />,
    );
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("td")).toHaveTextContent("Basics");
    expect(container.querySelector("blockquote")).toHaveTextContent("Every report has an approval path.");
    expect(container.textContent).not.toContain("| ---");
  });

  it("the chapter page uses it and escapes the Word export", () => {
    const page = readFileSync(resolve(__dirname, "../pages/manual-chapter.tsx"), "utf8");
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).toContain("<ManualMarkdown");
    expect(page).toContain("${escapeHtml(s.content)}");
  });
});
