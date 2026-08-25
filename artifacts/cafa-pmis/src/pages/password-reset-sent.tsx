import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { Mail, ArrowLeft } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function PasswordResetSentPage() {
  const { t } = useTranslation("auth");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const email = params.get("email") ?? "";

  return (
    <AuthShell>
      <div className="px-7 py-7">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <Mail className="h-8 w-8 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("resetLinkSent")}</h1>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              {email ? t("resetLinkSentDesc", { email }) : t("resetLinkSentDescNoEmail")}
            </p>
          </div>
          <p className="text-xs text-gray-400">
            {t("resetLinkExpiry")}
          </p>
          <div className="w-full max-w-xs space-y-3">
            <button
              type="button"
              onClick={() => setLocation("/login")}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm text-[#1E2D5B] hover:underline font-medium"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("returnToSignIn")}
            </button>
            <button
              type="button"
              onClick={() => setLocation("/forgot-password")}
              className="w-full text-sm text-gray-500 hover:text-gray-800 hover:underline transition-colors"
            >
              {t("didNotReceive")}
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center max-w-sm leading-relaxed">
          {t("privacyNote")}
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
