import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Loader2, ArrowLeft } from "lucide-react";
import cafaLogo from "@/assets/cafa-logo.png";
import { Button } from "@/components/ui/button";

function DotGrid() {
  return (
    <svg className="absolute top-0 end-0 w-56 h-52 opacity-20" viewBox="0 0 160 128" aria-hidden>
      {Array.from({ length: 8 }).map((_, r) =>
        Array.from({ length: 10 }).map((_, c) => (
          <circle key={`${r}-${c}`} cx={c * 16 + 8} cy={r * 16 + 8} r="2" fill="white" />
        ))
      )}
    </svg>
  );
}

type VerifyState = "loading" | "success" | "already_verified" | "invalid" | "expired" | "error";

export default function VerifyEmailPage() {
  const { t } = useTranslation("auth");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [state, setState] = useState<VerifyState>("loading");

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: "GET",
      credentials: "include",
    })
      .then(async (res) => {
        if (res.ok) { setState("success"); return; }
        const body = await res.json().catch(() => ({})) as { error?: string };
        switch (body.error) {
          case "token_used":
          case "already_verified": setState("already_verified"); break;
          case "token_expired": setState("expired"); break;
          default: setState("invalid");
        }
      })
      .catch(() => setState("error"));
  }, [token]);

  const isSuccess = state === "success" || state === "already_verified";
  const isError = state === "invalid" || state === "expired" || state === "error";

  const stateTitle: Record<VerifyState, string> = {
    loading:          t("verifyLoading"),
    success:          t("verifySuccess"),
    already_verified: t("verifyAlreadyVerified"),
    invalid:          t("verifyInvalid"),
    expired:          t("verifyExpired"),
    error:            t("verifyError"),
  };

  const stateBody: Record<VerifyState, string> = {
    loading:          t("verifyLoadingDesc"),
    success:          t("verifySuccessDesc"),
    already_verified: t("verifyAlreadyVerifiedDesc"),
    invalid:          t("verifyInvalidDesc"),
    expired:          t("verifyExpiredDesc"),
    error:            t("verifyErrorDesc"),
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
            {state === "loading" ? (
              <Loader2 className="h-12 w-12 text-gray-400 animate-spin" />
            ) : isSuccess ? (
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <XCircle className="h-9 w-9 text-red-500" />
              </div>
            )}

            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{stateTitle[state]}</h1>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">{stateBody[state]}</p>
            </div>

            {state !== "loading" && (
              <div className="w-full max-w-xs space-y-3 mt-2">
                {isSuccess && (
                  <Button
                    className="w-full bg-[#1a2744] hover:bg-[#243566] text-white font-semibold"
                    onClick={() => setLocation("/")}
                  >
                    {t("signInToAccount")}
                  </Button>
                )}
                {isError && (
                  <button
                    type="button"
                    onClick={() => setLocation("/")}
                    className="w-full text-sm text-[#1a2744] hover:underline font-medium"
                  >
                    {t("returnToSignIn")}
                  </button>
                )}
              </div>
            )}
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
              <p className="text-white/60 text-sm leading-snug">{t("internalSystemLabel")}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
