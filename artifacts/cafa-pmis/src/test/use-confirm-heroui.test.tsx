/**
 * The last four native window.confirm dialogs (HQ Sector and State Programme
 * submit without documents, command palette history, State lifecycle) now use
 * the shared HeroUI ConfirmModal through useConfirm.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useState } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { useConfirm } from "@/components/use-confirm";

function Harness() {
  const [confirm, dialog] = useConfirm();
  const [answer, setAnswer] = useState("none");
  return (
    <>
      <button type="button" onClick={async () => setAnswer(String(await confirm({
        title: "Submit without documents?", message: "No evidence attached.", confirmLabel: "Submit anyway", cancelLabel: "Go back",
      })))}>ask</button>
      <p data-testid="answer">{answer}</p>
      {dialog}
    </>
  );
}

afterEach(cleanup);

describe("USE-CONFIRM-HEROUI", () => {
  it("resolves true on confirm and false on cancel", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("ask"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Submit without documents?");
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));
    expect(await screen.findByText("true")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ask"));
    fireEvent.click(await screen.findByRole("button", { name: "Go back" }));
    expect(await screen.findByText("false")).toBeInTheDocument();
  });

  it("no source file calls the native window.confirm", () => {
    const src = resolve(__dirname, "..");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "test" ? [] : walk(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
    const offenders = walk(src).filter((path) =>
      readFileSync(path, "utf8").split("\n").some((line) => /window\.confirm\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)));
    expect(offenders).toEqual([]);
  });
});
