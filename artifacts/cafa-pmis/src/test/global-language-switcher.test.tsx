import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import i18n from "../i18n";
import { GlobalLanguageSwitcher } from "@/components/global-language-switcher";
import { LanguageProvider } from "@/contexts/language-context";

describe("GlobalLanguageSwitcher", () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  it("switches a keyboard user to Arabic, applies RTL, and persists the preference", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <GlobalLanguageSwitcher />
      </LanguageProvider>,
    );

    const trigger = screen.getByTestId("global-language-switcher");
    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
      expect(localStorage.getItem("cafa.lang")).toBe("ar");
    });
  });
});