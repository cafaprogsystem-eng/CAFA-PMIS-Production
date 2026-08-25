import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth-shell";

export default function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation("auth");

  const [email, setEmail]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [done, setDone]       = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("emailRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setError(t("tooManyRequests"));
        return;
      }
      if (!res.ok) {
        setError(t("somethingWentWrong"));
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.devResetLink) setDevLink(body.devResetLink);
      if (!body.devResetLink) {
        setLocation(`/password-reset-sent?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setDone(true);
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="px-7 py-7">

                {done ? (
                  /* ── Success state ── */
                  <div className="flex flex-col items-center text-center gap-4 py-4">
                    <div className="flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 border-2 border-emerald-200">
                      <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                    </div>
                    <h2 className="text-[24px] font-bold text-gray-900 leading-tight">
                      {t("checkEmail")}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {t("checkEmailDesc", { email })}
                    </p>
                    <p className="text-xs text-gray-400">
                      {t("linkExpires")}
                    </p>

                    {/* Dev-mode helper */}
                    {devLink && (
                      <div dir="ltr" className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 text-start mt-1">
                        <p className="text-xs font-semibold text-amber-800 mb-1.5">
                          {t("devMode")}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs text-amber-900 break-all bg-amber-100 rounded px-2 py-1 select-all">
                            {devLink}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(devLink);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 border border-amber-300 rounded px-2 py-1 transition-colors"
                          >
                            {copied ? t("copied") : t("copy")}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLocation(devLink.replace(window.location.origin, ""))}
                          className="mt-2 text-xs text-amber-700 hover:text-amber-900 underline"
                        >
                          {t("openResetPage")}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setLocation("/login")}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#1E2D5B] hover:underline font-medium"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t("returnToSignIn")}
                    </button>
                  </div>
                ) : (
                  /* ── Form state ── */
                  <>
                    <p className="text-[11px] font-semibold text-[#1E2D5B] mb-2 tracking-[0.14em] uppercase">
                      {t("forgotPasswordEyebrow")}
                    </p>
                    <h2 className="text-[24px] font-bold text-gray-900 leading-tight mb-2">
                      {t("forgotPasswordTitle")}
                    </h2>
                    <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                      {t("forgotPasswordDesc")}
                    </p>

                    {error && (
                      <Alert
                        id="forgot-password-error"
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
                      aria-label={t("forgotPasswordTitle")}
                      aria-describedby={error ? "forgot-password-error" : undefined}
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                          {t("emailAddress")}
                        </Label>
                        <div className="relative">
                          <span className="absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none start-3">
                            <Mail className="h-4 w-4" />
                          </span>
                          <input
                            id="email"
                            type="email"
                            dir="ltr"
                            autoComplete="email"
                            placeholder={t("emailPh")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={busy}
                            required
                            aria-invalid={error ? "true" : undefined}
                            className="w-full h-[46px] rounded-[10px] border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1E2D5B]/25 focus:border-[#1E2D5B]/70 transition-colors ps-10 pe-3"
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={busy}
                        className="w-full h-[46px] bg-[#1E2D5B] hover:bg-[#192752] hover:-translate-y-px active:bg-[#141f44] active:translate-y-0 text-white text-sm font-semibold rounded-[10px] tracking-wide shadow-[0_1px_3px_rgba(0,0,0,0.14)] hover:shadow-[0_3px_10px_rgba(30,45,91,0.28)] transition-all duration-[190ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E2D5B] focus-visible:ring-offset-2"
                      >
                        {busy ? (
                          <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                            {t("sending")}
                          </>
                        ) : (
                          t("sendResetLink")
                        )}
                      </Button>
                    </form>

                    <div className="mt-6 flex justify-center">
                      <button
                        type="button"
                        onClick={() => setLocation("/login")}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                      >
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
