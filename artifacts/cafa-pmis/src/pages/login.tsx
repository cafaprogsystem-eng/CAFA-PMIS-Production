import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { Alert, Button, Checkbox, InputGroup, Label, Spinner, TextField, ToggleButton } from "@heroui/react";
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
          aria-label={t("signInTo")}
          aria-describedby={error ? "login-error" : undefined}
        >

          {/* Identifier */}
          <TextField
            id="identifier"
            autoComplete="username"
            value={identifier}
            onChange={setIdentifier}
            isDisabled={busy}
            isInvalid={!!error}
            fullWidth
          >
            <Label>{t("identifier")}</Label>
            <InputGroup fullWidth>
              <InputGroup.Prefix>
                <Mail className="h-4 w-4" />
              </InputGroup.Prefix>
              <InputGroup.Input dir="ltr" placeholder={t("identifierPh")} />
            </InputGroup>
          </TextField>

          {/* Password */}
          <TextField
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            isDisabled={busy}
            isInvalid={!!error}
            fullWidth
          >
            <div className="flex items-center justify-between">
              <Label>{t("password")}</Label>
              <Button variant="ghost" size="sm" onPress={() => setLocation("/forgot-password")}>
                {t("forgotPassword")}
              </Button>
            </div>
            <InputGroup fullWidth>
              <InputGroup.Prefix>
                <Lock className="h-4 w-4" />
              </InputGroup.Prefix>
              <InputGroup.Input dir="ltr" placeholder="••••••••" />
              <InputGroup.Suffix>
                <ToggleButton
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isSelected={showPw}
                  onChange={setShowPw}
                  aria-label={showPw ? t("hidePassword") : t("showPassword")}
                  aria-controls="password"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </ToggleButton>
              </InputGroup.Suffix>
            </InputGroup>
          </TextField>

          {/* Remember me */}
          <Checkbox isSelected={remember} onChange={setRemember} isDisabled={busy}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>{t("rememberMe")}</Label>
            </Checkbox.Content>
          </Checkbox>

          {/* Submit */}
          <Button type="submit" size="lg" fullWidth isPending={busy}>
            {busy ? (
              <>
                <Spinner size="sm" color="current" />
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
