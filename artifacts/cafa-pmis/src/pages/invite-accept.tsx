import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getLinkedStateLabel } from "@/components/state-label";

type InviteInfo = {
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  sector: string | null;
  stateName: string | null;
  stateNameAr?: string | null;
  expiresAt: string;
};

function strengthScore(pw: string): { score: number; labelKey: string; color: string } {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { labelKey: "tooWeak", color: "bg-red-500" },
    { labelKey: "weak", color: "bg-orange-500" },
    { labelKey: "fair", color: "bg-yellow-500" },
    { labelKey: "good", color: "bg-lime-500" },
    { labelKey: "strong", color: "bg-green-500" },
    { labelKey: "excellent", color: "bg-emerald-600" },
  ];
  return { score: s, ...map[s] };
}

const ERROR_KEYS: Record<string, string> = {
  invite_invalid_or_used: "errors.inviteInvalidOrUsed",
  invite_expired: "errors.inviteExpired",
  invite_already_accepted: "errors.inviteAlreadyAccepted",
  token_required: "errors.tokenRequired",
  password_too_short: "errors.invitePasswordTooShort",
  password_too_long: "errors.invitePasswordTooLong",
  password_missing_letter: "errors.invitePasswordMissingLetter",
  password_missing_digit: "errors.invitePasswordMissingDigit",
  password_too_common: "errors.invitePasswordTooCommon",
};

export default function InviteAcceptPage() {
  const { t, i18n } = useTranslation("auth");

  // Support both /invite/:token (path param) and /accept-invitation?token= (query param)
  const params = useParams<{ token?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const token = useMemo(() => {
    // Path param takes priority; fall back to ?token= query string
    if (params.token) return params.token;
    const qs = new URLSearchParams(search);
    return qs.get("token") ?? "";
  }, [params.token, search]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use query-param endpoint if token came from ?token= (no path param)
  const lookupUrl = params.token
    ? `/api/auth/invite/${encodeURIComponent(token)}`
    : `/api/auth/accept-invitation?token=${encodeURIComponent(token)}`;

  const { data, isLoading, error: loadError } = useQuery<InviteInfo>({
    queryKey: ["invite", token],
    queryFn: async () => {
      if (!token) throw new Error("token_required");
      const res = await fetch(lookupUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    retry: false,
    enabled: !!token,
  });

  const strength = useMemo(() => strengthScore(password), [password]);

  useEffect(() => { document.title = "Activate your account · CAFA PMIS"; }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError(t("passwordMismatch")); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_KEYS[body.error] ? t(ERROR_KEYS[body.error]) : t("somethingWentWrong"));
        return;
      }
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      setLocation("/");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/40">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> {t("noInviteToken")}</CardTitle>
            <CardDescription>{t(ERROR_KEYS["token_required"])}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setLocation("/")}>{t("goToSignIn")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (loadError) {
    const code = (loadError as Error).message;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/40">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> {t("invitationUnavailable")}</CardTitle>
            <CardDescription>{ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : t("somethingWentWrong")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setLocation("/")}>{t("goToSignIn")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!data) return null;

  const expires = new Date(data.expiresAt).toLocaleString();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <div className="text-xs font-semibold text-primary tracking-wide uppercase">{t("cafaPMSEyebrow")}</div>
          <CardTitle>{t("activateYourAccount")}</CardTitle>
          <CardDescription>{t("activateYourAccountDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div><span className="text-muted-foreground">{t("name")}: </span><span className="font-medium">{data.name}</span></div>
            <div><span className="text-muted-foreground">{t("email")}: </span><span className="font-medium">{data.email}</span></div>
            <div><span className="text-muted-foreground">{t("role")}: </span><span className="font-medium">{data.roleLabel}</span></div>
            {data.stateName && <div><span className="text-muted-foreground">{t("state")}: </span><span className="font-medium">{getLinkedStateLabel(data, i18n?.language)}</span></div>}
            {data.sector && <div><span className="text-muted-foreground">{t("sector")}: </span><span className="font-medium">{data.sector}</span></div>}
            <div className="text-xs text-muted-foreground pt-1">{t("linkExpiresLabel")}: {expires}</div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">{t("newPasswordLabel")}</Label>
               <Input id="pw" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full transition-all ${strength.color}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                </div>
                 <span dir="rtl" className="text-xs text-muted-foreground w-20 text-end">{password ? t(`passwordStrength.${strength.labelKey}`) : ""}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t("passwordAtLeastChars")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t("confirmPasswordLabel")}</Label>
               <Input id="confirm" dir="ltr" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{t("couldntActivate")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={submitting || password.length < 10 || password !== confirm}>
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("activating")}</> : <><CheckCircle2 className="h-4 w-4" /> {t("activateAccount")}</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
