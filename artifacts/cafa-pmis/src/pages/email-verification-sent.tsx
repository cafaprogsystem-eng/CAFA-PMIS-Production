import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { Mail, ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";
import cafaLogo from "@/assets/cafa-logo.png";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function DotGrid() {
  return (
    <svg className="absolute top-0 right-0 w-56 h-52 opacity-20" viewBox="0 0 160 128" aria-hidden>
      {Array.from({ length: 8 }).map((_, r) =>
        Array.from({ length: 10 }).map((_, c) => (
          <circle key={`${r}-${c}`} cx={c * 16 + 8} cy={r * 16 + 8} r="2" fill="white" />
        ))
      )}
    </svg>
  );
}

export default function EmailVerificationSentPage() {
  const { t } = useTranslation("auth");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const email = params.get("email") ?? "";
  const [resending, setResending] = useState(false);

  const resend = async () => {
    if (!email) return;
    setResending(true);
    try {
      const res = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        toast.error(t("tooManyRequestsResend"));
      } else if (res.ok) {
        toast.success(t("verificationResent"));
      } else {
        toast.error(t("somethingWentWrong"));
      }
    } catch {
      toast.error(t("networkError"));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eaecf0] flex flex-col">
      <header className="flex justify-start px-6 py-4">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("backToSignIn")}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[820px] rounded-2xl shadow-xl overflow-hidden flex flex-col sm:flex-row">
          <div className="bg-white flex-1 px-10 py-14 flex flex-col justify-center items-center text-center gap-5">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
              <Mail className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("checkEmail")}</h1>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                {email ? t("verificationSentDesc", { email }) : t("verificationSentDescNoEmail")}
              </p>
            </div>
            <div className="w-full max-w-xs space-y-3 mt-2">
              <p className="text-xs text-gray-400">
                {t("verificationLinkExpiry")}
              </p>
              {email && (
                <Button
                  variant="outline"
                  className="w-full text-sm"
                  onClick={resend}
                  disabled={resending}
                >
                  {resending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("resending")}</>
                  ) : (
                    <><RefreshCw className="h-3.5 w-3.5" /> {t("resendVerification")}</>
                  )}
                </Button>
              )}
              <button
                type="button"
                onClick={() => setLocation("/")}
                className="w-full text-sm text-[#1a2744] hover:underline font-medium"
              >
                {t("returnToSignIn")}
              </button>
            </div>
          </div>

          <div className="relative hidden sm:flex bg-[#1a2744] sm:w-[320px] shrink-0 flex-col items-center justify-center px-10 py-14 overflow-hidden">
            <DotGrid />
            <div className="relative z-10 flex flex-col items-center text-center gap-0">
              <img src={cafaLogo} alt="CAFA" className="w-28 h-28 object-contain mb-4"
                style={{ filter: "brightness(0) invert(1)" }} />
              <p className="text-white/50 text-xs tracking-widest uppercase mb-6 font-medium">
                {t("rebuildingHope")}
              </p>
              <div className="w-12 h-px bg-white/25 mb-6" />
              <p className="text-white font-bold text-base leading-snug mb-2">{t("cafaProgrammeManagementSystem")}</p>
              <p className="text-white/60 text-sm leading-snug">{t("common:programmeManagementSystem")}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
