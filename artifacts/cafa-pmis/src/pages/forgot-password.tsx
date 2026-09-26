import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Alert, Button, InputGroup, Label, Spinner, TextField } from "@heroui/react";
import { AuthShell } from "@/components/auth-shell";

// Auth pages keep their own navy brand rather than the app palette; these
// override HeroUI's primary button tokens without touching its shape.
const BRAND_BUTTON =
  "[--button-bg:#1E2D5B] [--button-bg-hover:#192752] [--button-bg-pressed:#141f44] [--button-fg:white]";

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

  // "Back" points toward the reading start, so it mirrors in RTL.
  const backIcon = <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />;

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
                      <Alert status="warning" dir="ltr" className="w-full text-start mt-1">
                        <Alert.Content className="min-w-0">
                          <Alert.Title>{t("devMode")}</Alert.Title>
                          <div className="flex items-center gap-2 mt-1.5">
                            <code className="flex-1 text-xs text-amber-900 break-all bg-amber-100 rounded px-2 py-1 select-all">
                              {devLink}
                            </code>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onPress={() => {
                                navigator.clipboard.writeText(devLink);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                            >
                              {copied ? t("copied") : t("copy")}
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 underline"
                            onPress={() => setLocation(devLink.replace(window.location.origin, ""))}
                          >
                            {t("openResetPage")}
                          </Button>
                        </Alert.Content>
                      </Alert>
                    )}

                    <Button variant="ghost" className="mt-1 text-[#1E2D5B]" onPress={() => setLocation("/login")}>
                      {backIcon}
                      {t("returnToSignIn")}
                    </Button>
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
                        status="danger"
                        role="alert"
                        aria-live="assertive"
                        className="mb-5"
                      >
                        <Alert.Indicator />
                        <Alert.Content>
                          {/* Title, not Description: only the title takes the danger colour. */}
                          <Alert.Title>{error}</Alert.Title>
                        </Alert.Content>
                      </Alert>
                    )}

                    <form
                      className="space-y-5"
                      onSubmit={onSubmit}
                      noValidate
                      aria-label={t("forgotPasswordTitle")}
                      aria-describedby={error ? "forgot-password-error" : undefined}
                    >
                      <TextField
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={setEmail}
                        isDisabled={busy}
                        isInvalid={!!error}
                        fullWidth
                      >
                        <Label>{t("emailAddress")}</Label>
                        <InputGroup fullWidth>
                          <InputGroup.Prefix>
                            <Mail className="h-4 w-4" />
                          </InputGroup.Prefix>
                          {/* HeroUI drops the input's inline-start padding beside a prefix,
                              but an ltr input inside an rtl group puts its "start" on the
                              far edge — symmetric padding keeps both directions correct. */}
                          <InputGroup.Input dir="ltr" placeholder={t("emailPh")} className="px-3" />
                        </InputGroup>
                      </TextField>

                      <Button type="submit" size="lg" fullWidth isPending={busy} className={BRAND_BUTTON}>
                        {busy ? (
                          <>
                            <Spinner size="sm" color="current" />
                            {t("sending")}
                          </>
                        ) : (
                          t("sendResetLink")
                        )}
                      </Button>
                    </form>

                    <div className="mt-6 flex justify-center">
                      <Button variant="ghost" size="sm" onPress={() => setLocation("/login")}>
                        {backIcon}
                        {t("backToSignIn")}
                      </Button>
                    </div>
                  </>
                )}

      </div>
    </AuthShell>
  );
}
