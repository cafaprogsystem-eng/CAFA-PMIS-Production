import { useState, useMemo, type FormEvent } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, ArrowLeft, Loader2, CheckCircle2, ShieldAlert, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth-shell";

function strengthScore(pw: string): { score: number; labelKey: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { labelKey: "tooWeak", color: "bg-red-500" },
    { labelKey: "weak", color: "bg-orange-500" },
    { labelKey: "fair", color: "bg-yellow-500" },
    { labelKey: "good", color: "bg-lime-500" },
    { labelKey: "strong", color: "bg-green-500" },
    { labelKey: "excellent", color: "bg-emerald-600" },
  ];
  return { score: s, ...map[Math.min(s, 5)] };
}

// Matches the server's actual policy exactly (lib/password.ts in the API):
// at least 10 characters, one letter, one digit. No case or special-character
// requirement — a client-side rule stricter than the server's would block a
// password the server would otherwise accept, with the submit button just
// staying disabled and no error ever shown.
function validateRules(pw: string) {
  return {
    length: pw.length >= 10,
    letter: /[A-Za-z]/.test(pw),
    digit:  /[0-9]/.test(pw),
  };
}

const ERROR_KEYS: Record<string, string> = {
  token_invalid: "errors.tokenInvalid",
  token_used: "errors.tokenUsed",
  token_revoked: "errors.tokenRevoked",
  token_expired: "errors.tokenExpired",
  password_too_short: "errors.passwordTooShort",
  password_too_long: "errors.passwordTooLong",
  password_missing_letter: "errors.passwordMissingLetter",
  password_missing_digit: "errors.passwordMissingDigit",
  password_too_common: "errors.passwordTooCommon",
};

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function ResetPasswordPage() {
  const { t } = useTranslation("auth");

  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const token  = params.get("token") ?? "";
  const qc     = useQueryClient();

  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showPw, setShowPw]           = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy]               = useState(false);
  const [done, setDone]               = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const { data: tokenInfo, isLoading, error: tokenError } = useQuery({
    queryKey: ["reset-token", token],
    queryFn: async () => {
      const res = await fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ email: string; name: string }>;
    },
    enabled: !!token,
    retry: false,
  });

  const strength  = useMemo(() => strengthScore(password), [password]);
  const rules     = useMemo(() => validateRules(password), [password]);
  const allPass   = Object.values(rules).every(Boolean);
  const mismatch  = confirm.length > 0 && password !== confirm;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!allPass) { setError(t("passwordDoesNotMeet")); return; }
    if (password !== confirm) { setError(t("passwordsDoNotMatch")); return; }
    setBusy(true);
    try {
      const res  = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(ERROR_KEYS[body.error] ? t(ERROR_KEYS[body.error]) : t("failedToReset")); return; }
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      setDone(true);
    } catch {
      setError(t("networkErrorCheck"));
    } finally {
      setBusy(false);
    }
  };

  /* Loading */
  if (isLoading) {
    return (
      <AuthShell>
        <div className="px-9 py-16 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#1E2D5B]" />
          <p className="text-sm text-gray-500">
            {t("validatingResetLink")}
          </p>
        </div>
      </AuthShell>
    );
  }

  /* No token */
  if (!token) {
    return (
      <AuthShell>
        <div className="px-9 py-12 flex flex-col items-center text-center gap-4">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-red-50 border-2 border-red-200">
            <ShieldAlert className="h-9 w-9 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t("invalidResetLink")}
          </h2>
          <p className="text-sm text-gray-500">
            {t("noTokenFound")}
          </p>
          <button type="button" onClick={() => setLocation("/forgot-password")}
            className="mt-2 text-sm text-[#1E2D5B] hover:underline font-medium">
            {t("requestNewLink")}
          </button>
        </div>
      </AuthShell>
    );
  }

  /* Token error */
  if (tokenError || !tokenInfo) {
    const code = (tokenError as Error)?.message ?? "token_invalid";
    return (
      <AuthShell>
        <div className="px-9 py-12 flex flex-col items-center text-center gap-4">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-red-50 border-2 border-red-200">
            <ShieldAlert className="h-9 w-9 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t("resetLinkUnavailable")}
          </h2>
        <p className="text-sm text-gray-500">{ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : t("linkInvalidOrExpired")}</p>
          <button type="button" onClick={() => setLocation("/forgot-password")}
            className="mt-2 text-sm text-[#1E2D5B] hover:underline font-medium">
            {t("requestANewLink")}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="px-7 py-7">

        {done ? (
          /* ── Success ── */
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 border-2 border-emerald-200">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {t("passwordResetDone")}
            </h2>
            <p className="text-sm text-gray-500">
              {t("passwordResetDoneDesc")}
            </p>
            <button type="button" onClick={() => setLocation("/login")}
              className="mt-3 inline-block px-8 py-2.5 bg-[#1E2D5B] text-white text-sm font-semibold rounded-lg hover:bg-[#253972] transition-colors shadow-md">
              {t("signIn")}
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <>
            <p className="text-sm font-semibold text-[#1E2D5B] mb-1 tracking-wide uppercase">
              {t("newPasswordEyebrow")}
            </p>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {t("resetYourPassword")}
            </h2>
              <p className="text-sm text-gray-400 mb-7">
              {t("settingNewPasswordFor")} <strong dir="ltr" className="text-gray-600">{tokenInfo.email}</strong>
            </p>

            {error && (
              <Alert variant="destructive" className="mb-5 py-2">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              {/* New password */}
              <div className="space-y-1.5">
                <Label htmlFor="pw" className="text-sm font-medium text-gray-700">
                  {t("newPasswordFieldLabel")}
                </Label>
                <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none start-3">
                    <Lock className="h-4 w-4" />
                  </span>
                  <input
                    id="pw"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={busy}
                    required
                     dir="ltr"
                     aria-label={t("newPasswordFieldLabel")}
                     className="w-full h-11 rounded-lg border border-gray-200 bg-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E2D5B]/20 focus:border-[#1E2D5B]/60 transition-colors ps-10 pe-11"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPw(v => !v)}
                    className="absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors end-3">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Strength bar */}
                {password.length > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full transition-all duration-300 ${strength.color}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                    </div>
                     <span dir="rtl" className="text-xs text-gray-500 w-16 text-end">{t(`passwordStrength.${strength.labelKey}`)}</span>
                  </div>
                )}

                {/* Rules */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-2">
                  {[
                    { ok: rules.length, label: t("rulesLength") },
                    { ok: rules.letter, label: t("rulesLetter") },
                    { ok: rules.digit,  label: t("rulesDigit") },
                  ].map(({ ok, label }) => (
                    <p key={label} className={`text-xs flex items-center gap-1 ${ok ? "text-emerald-600" : "text-gray-400"}`}>
                      <span>{ok ? "✓" : "○"}</span> {label}
                    </p>
                  ))}
                </div>
              </div>

              {/* Confirm */}
              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-sm font-medium text-gray-700">
                  {t("confirmNewPassword")}
                </Label>
                <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none start-3">
                    <Lock className="h-4 w-4" />
                  </span>
                  <input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    disabled={busy}
                    required
                     dir="ltr"
                     aria-label={t("confirmNewPassword")}
                     className={`w-full h-11 rounded-lg border bg-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 transition-colors ${mismatch ? "border-red-400 focus:ring-red-200" : "border-gray-200 focus:ring-[#1E2D5B]/20 focus:border-[#1E2D5B]/60"} ps-10 pe-11`}
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowConfirm(v => !v)}
                    className="absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors end-3">
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mismatch && (
                  <p className="text-xs text-red-500">
                    {t("passwordsDoNotMatch")}
                  </p>
                )}
              </div>

              <Button type="submit" disabled={busy || !allPass || password !== confirm}
                className="w-full h-11 bg-[#1E2D5B] hover:bg-[#253972] text-white text-sm font-semibold rounded-lg tracking-wide shadow-md hover:shadow-lg transition-all mt-1">
                {busy
                      ? <><Loader2 className="h-4 w-4 animate-spin" />{t("resetting")}</>
                  : t("resetPassword")
                }
              </Button>
            </form>

            <div className="mt-5 flex justify-center">
              <button type="button" onClick={() => setLocation("/login")}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("backToSignIn")}
              </button>
            </div>

          </>
        )}
      </div>
    </AuthShell>
  );
}
