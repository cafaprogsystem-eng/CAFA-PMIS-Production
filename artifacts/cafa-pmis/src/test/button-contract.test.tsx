import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Button, buttonVariants } from "@/components/ui/button";

const testDir = dirname(fileURLToPath(import.meta.url));
const reportsSource = readFileSync(resolve(testDir, "../pages/reports.tsx"), "utf-8");
const plansSource = readFileSync(resolve(testDir, "../pages/plan-detail.tsx"), "utf-8");
const usersSource = readFileSync(resolve(testDir, "../pages/users.tsx"), "utf-8");
const filesSource = readFileSync(resolve(testDir, "../pages/files.tsx"), "utf-8");
const registrationSource = readFileSync(resolve(testDir, "../components/project-registration-form.tsx"), "utf-8");
const driveAttachmentSource = readFileSync(resolve(testDir, "../components/drive-attachment-panel.tsx"), "utf-8");
const verificationSource = readFileSync(resolve(testDir, "../pages/email-verification-sent.tsx"), "utf-8");

describe("Button labelled-action contract", () => {
  it("keeps labelled actions inline, no-wrap, clickable, and focus-visible", () => {
    const { getByRole } = render(
      <Button variant="outline">
        <ArrowRight aria-hidden="true" />
        Continue
      </Button>,
    );
    const button = getByRole("button", { name: "Continue" });

    expect(button.className).toContain("inline-flex");
    expect(button.className).toContain("items-center");
    expect(button.className).toContain("whitespace-nowrap");
    expect(button.className).toContain("cursor-pointer");
    expect(button.className).toContain("focus-visible:ring-2");
    expect(button.querySelector("span.inline-flex")).toBeTruthy();
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.textContent).toContain("Continue");
  });

  it("uses documented small, default, and large dimensions with the token radius", () => {
    expect(buttonVariants({ size: "sm" })).toContain("h-9");
    expect(buttonVariants({ size: "sm" })).toContain("px-3");
    expect(buttonVariants({ size: "default" })).toContain("h-10");
    expect(buttonVariants({ size: "default" })).toContain("px-4");
    expect(buttonVariants({ size: "lg" })).toContain("h-11");
    expect(buttonVariants({ size: "lg" })).toContain("px-6");

    for (const size of ["sm", "default", "lg"] as const) {
      expect(buttonVariants({ size })).toContain("rounded-lg");
    }
  });

  it("preserves icon-only compact controls without requiring a visible label", () => {
    render(
      <Button size="icon" aria-label="Next">
        <ArrowRight aria-hidden="true" />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Next" });
    expect(button.className).toContain("h-10");
    expect(button.className).toContain("w-10");
    expect(button.textContent).toBe("");
  });

  it("keeps loading content horizontal and preserves the button size", () => {
    render(
      <Button isLoading loadingText="Saving report">
        <Loader2 aria-hidden="true" />
        Save report
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Saving report/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.className).toContain("h-10");
    expect(button.className).toContain("cursor-not-allowed");
    expect(button.querySelector("span.inline-flex")).toHaveTextContent("Save report");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("keeps semantic variants and RTL-safe DOM ordering", () => {
    render(
      <div dir="rtl">
        <Button variant="destructive">
          <ArrowRight aria-hidden="true" />
          حذف
        </Button>
      </div>,
    );
    const button = screen.getByRole("button", { name: "حذف" });
    const content = button.querySelector("span.inline-flex");
    expect(content?.firstElementChild?.tagName).toBe("svg");
    expect(button.className).toContain("bg-destructive");
  });

  it("retains primary, secondary, outline, ghost, and danger semantic hierarchy", () => {
    expect(buttonVariants({ variant: "default" })).toContain("bg-primary");
    expect(buttonVariants({ variant: "secondary" })).toContain("bg-secondary");
    expect(buttonVariants({ variant: "outline" })).toContain("border-border");
    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-accent");
    expect(buttonVariants({ variant: "destructive" })).toContain("bg-destructive");
  });

  it("does not change an enabled action's single-click behaviour", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save changes</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Migrated labelled action surfaces", () => {
  it("keeps report page actions in a wrapping group with primitive-owned icon spacing", () => {
    expect(reportsSource).toContain('className="flex flex-wrap gap-2 items-center"');
    expect(reportsSource).toContain('<Download className="h-4 w-4" />');
    expect(reportsSource).not.toContain('<Download className="me-2 h-4 w-4" />');
    expect(reportsSource).not.toContain('<Send className="me-2 h-4 w-4"');
  });

  it("keeps planning, users, and files action bars responsive without ad hoc icon margins", () => {
    expect(plansSource).toContain('flex items-center gap-2 flex-shrink-0 flex-wrap');
    expect(plansSource).not.toContain('<Pencil className="h-4 w-4 mr-1.5"');
    expect(usersSource).toContain('className="w-full sm:w-auto"');
    expect(usersSource).not.toContain('<Plus className="h-4 w-4 me-2"');
    expect(filesSource).toContain('flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row');
    expect(filesSource).not.toContain('<Upload className="me-2 h-4 w-4"');
  });

  it("uses the shared loading contract in the project document action", () => {
    expect(registrationSource).toContain('isLoading={uploading}');
    expect(registrationSource).not.toContain('className="h-8 pointer-events-none"');
    expect(registrationSource).toContain('{!uploading && <Upload className="h-3.5 w-3.5" />}');
    expect(registrationSource).toContain('onClick={() => fileInputRef.current?.click()}');
  });

  it("keeps upload and verification actions on primitive-owned icon spacing", () => {
    expect(driveAttachmentSource).toContain('<Upload className="h-3.5 w-3.5" />');
    expect(driveAttachmentSource).not.toContain('h-3.5 w-3.5 mr-1');
    expect(driveAttachmentSource).not.toContain('animate-spin mr-');
    expect(verificationSource).toContain('<RefreshCw className="h-3.5 w-3.5" />');
    expect(verificationSource).not.toContain('animate-spin mr-');
  });
});