import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, ShieldAlert } from "@/components/icons";
import { Alert, Button, Card, Spinner } from "@heroui/react";
import { getLinkedStateLabel } from "@/components/state-label";
import { PasswordField } from "@/components/password-field";

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
          <Card.Header>
            <Card.Title className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> {t("noInviteToken")}</Card.Title>
            <Card.Description>{t(ERROR_KEYS["token_required"])}</Card.Description>
          </Card.Header>
          <Card.Footer>
            <Button variant="outline" onPress={() => setLocation("/")}>{t("goToSignIn")}</Button>
          </Card.Footer>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (loadError) {
    const code = (loadError as Error).message;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/40">
        <Card className="max-w-md w-full">
          <Card.Header>
            <Card.Title className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> {t("invitationUnavailable")}</Card.Title>
            <Card.Description>{ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : t("somethingWentWrong")}</Card.Description>
          </Card.Header>
          <Card.Footer>
            <Button variant="outline" onPress={() => setLocation("/")}>{t("goToSignIn")}</Button>
          </Card.Footer>
        </Card>
      </div>
    );
  }
  if (!data) return null;

  const expires = new Date(data.expiresAt).toLocaleString();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100">
      <Card className="max-w-lg w-full">
        <Card.Header>
          <div className="text-xs font-semibold text-primary tracking-wide uppercase">{t("cafaPMSEyebrow")}</div>
          <Card.Title>{t("activateYourAccount")}</Card.Title>
          <Card.Description>{t("activateYourAccountDesc")}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-5">
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div><span className="text-muted-foreground">{t("name")}: </span><span className="font-medium">{data.name}</span></div>
            <div><span className="text-muted-foreground">{t("email")}: </span><span className="font-medium">{data.email}</span></div>
            <div><span className="text-muted-foreground">{t("role")}: </span><span className="font-medium">{data.roleLabel}</span></div>
            {data.stateName && <div><span className="text-muted-foreground">{t("state")}: </span><span className="font-medium">{getLinkedStateLabel(data, i18n?.language)}</span></div>}
            {data.sector && <div><span className="text-muted-foreground">{t("sector")}: </span><span className="font-medium">{data.sector}</span></div>}
            <div className="text-xs text-muted-foreground pt-1">{t("linkExpiresLabel")}: {expires}</div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <PasswordField
              id="pw"
              label={t("newPasswordLabel")}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            >
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full transition-all ${strength.color}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                </div>
                 <span dir="rtl" className="text-xs text-muted-foreground w-20 text-end">{password ? t(`passwordStrength.${strength.labelKey}`) : ""}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t("passwordAtLeastChars")}</p>
            </PasswordField>
            <PasswordField
              id="confirm"
              label={t("confirmPasswordLabel")}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            {error && (
              <Alert status="danger" role="alert">
                <Alert.Indicator><AlertCircle className="h-4 w-4" aria-hidden /></Alert.Indicator>
                <Alert.Content>
                  <Alert.Title>{t("couldntActivate")}</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
            <Button type="submit" fullWidth isPending={submitting} isDisabled={submitting || password.length < 10 || password !== confirm}>
                  {submitting ? <><Spinner size="sm" color="current" /> {t("activating")}</> : <><CheckCircle2 className="h-4 w-4" /> {t("activateAccount")}</>}
            </Button>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}
