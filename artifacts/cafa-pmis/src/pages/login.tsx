import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth-shell";

const RETURNING_USER_KEY = "cafa.hasSignedIn";

function hasPreviouslySignedIn(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(RETURNING_USER_KEY) === "true";
  } catch {
    return false;
  }
}

export default function LoginPage() {
  const qc = useQueryClient();
  const { t } = useTranslation("auth");

  const [hasReturningUser, setHasReturningUser] = useState(hasPreviouslySignedIn);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setLocation] = useLocation();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError(t("requiredFields"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier: identifier.trim(), password, remember }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(t("tooManyRequests"));
        } else if (res.status === 403 && errBody.error === "account_not_active") {
          setError(t("accountNotActive"));
        } else {
          // Wrong password, unknown identifier, and a missing field all collapse
          // to the same generic message — anything more specific here would let
          // an attacker enumerate which accounts exist.
          setError(t("invalidCredentials"));
        }
        setBusy(false);
        return;
      }
      const body = await res.json();
      try {
        window.localStorage.setItem(RETURNING_USER_KEY, "true");
        setHasReturningUser(true);
      } catch {
        // Storage is optional and must not affect a successful sign-in.
      }
      if (body?.user?.id) {
        window.localStorage.setItem("cafa.userId", String(body.user.id));
      }
      qc.invalidateQueries();
      window.location.assign(import.meta.env.BASE_URL || "/");
    } catch {
      setError(t("networkError"));
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="px-7 py-7">

        {/* Card header */}
        {hasReturningUser && (
          <p className="text-xs font-medium text-gray-500 mb-2">
            {t("welcomeBack")}
          </p>
        )}
        <h2 className="text-[24px] font-bold text-gray-900 leading-tight mb-2">
          {t("signInTo")}
        </h2>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          {t("signInAccount")}
        </p>

        {error && (
          <Alert
            id="login-error"
            variant="destructive"
            aria-live="assertive"
            className="mb-5 py-2"
          >
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <form
          className="space-y-5"
          onSubmit={onSubmit}
          noValidate
          aria-label={t("signInTo")}
          aria-describedby={error ? "login-error" : undefined}
        >

          {/* Identifier */}
          <div className="space-y-1.5">
            <Label
              htmlFor="identifier"
              className="text-sm font-medium text-gray-700"
            >
              {t("identifier")}
            </Label>
            <div className="relative">
              <span className="absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none start-3">
                <Mail className="h-4 w-4" />
              </span>
              <input
                id="identifier"
                type="text"
                dir="ltr"
                autoComplete="username"
                placeholder={t("identifierPh")}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={busy}
                required
                aria-invalid={error ? "true" : undefined}
                className="w-full h-[46px] rounded-[10px] border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E2D5B]/25 focus:border-[#1E2D5B]/70 transition-colors ps-10 pe-3"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="password"
                className="text-sm font-medium text-gray-700"
              >
                {t("password")}
              </Label>
              <button
                type="button"
                onClick={() => setLocation("/forgot-password")}
                className="text-xs text-[#2563eb] hover:underline font-medium"
              >
                {t("forgotPassword")}
              </button>
            </div>
            <div className="relative">
              <span className="absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none start-3">
                <Lock className="h-4 w-4" />
              </span>
              <input
                id="password"
                type={showPw ? "text" : "password"}
                dir="ltr"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
                aria-invalid={error ? "true" : undefined}
                className="w-full h-[46px] rounded-[10px] border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E2D5B]/25 focus:border-[#1E2D5B]/70 transition-colors ps-10 pe-11"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t("hidePassword") : t("showPassword")}
                aria-controls="password"
                aria-pressed={showPw}
                className="absolute top-1/2 -translate-y-1/2 rounded-sm p-1 text-gray-400 hover:text-gray-600 transition-colors end-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E2D5B]/40"
              >
                {showPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="remember-me"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              disabled={busy}
              className="h-[18px] w-[18px] border-gray-300 shrink-0"
            />
            <Label htmlFor="remember-me" className="cursor-pointer select-none text-sm text-gray-600">
              {t("rememberMe")}
            </Label>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            disabled={busy}
            className="w-full h-[46px] bg-[#1E2D5B] hover:bg-[#192752] hover:-translate-y-px active:bg-[#141f44] active:translate-y-0 text-white text-sm font-semibold rounded-[10px] tracking-wide shadow-[0_1px_3px_rgba(0,0,0,0.14)] hover:shadow-[0_3px_10px_rgba(30,45,91,0.28)] transition-all duration-[190ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E2D5B] focus-visible:ring-offset-2"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("signingIn")}
              </>
            ) : (
              t("signIn")
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {t("signInFooter")}
        </p>
      </div>
    </AuthShell>
  );
}
