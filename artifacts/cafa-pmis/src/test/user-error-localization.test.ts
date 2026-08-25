import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { localizeUserApiError, USER_API_ERROR_KEYS } from "../lib/user-error-localization";

const ar = JSON.parse(readFileSync("src/locales/ar/users.json", "utf8")) as {
  errors: Record<string, string>;
};

function arabicT(key: string, options?: Record<string, unknown>) {
  const leaf = key.replace("errors.", "");
  if (key === "errors.errorCode") return ar.errors.errorCode.replace("{{code}}", String(options?.code));
  return ar.errors[leaf] ?? key;
}

describe("User API error localisation", () => {
  it("maps every supported server error code through the Arabic users namespace", () => {
    for (const [code, key] of Object.entries(USER_API_ERROR_KEYS)) {
      expect(localizeUserApiError(arabicT, code)).toBe(ar.errors[key]);
    }
  });

  it("uses Arabic fallbacks for empty and unknown API error codes without exposing server detail", () => {
    expect(localizeUserApiError(arabicT, "")).toBe(ar.errors.failedToSave);
    expect(localizeUserApiError(arabicT, "unexpected_server_code")).toBe("خطأ: unexpected_server_code");
  });
});