import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/contexts/language-context";
import cafaLogo from "@/assets/cafa-logo.png";
import cafaIcon from "@/assets/cafa-icon.png";
import fieldBg from "@/assets/cafa-field.png";

const CSS = `
@keyframes cafaBgZoom {
  from { transform: scale(1.08); }
  to   { transform: scale(1.02); }
}
@keyframes cafaFadeUp {
  from { opacity: 0; transform: translateY(22px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cafaFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.cafa-bg-img { animation: cafaBgZoom 10s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
.cafa-card   { animation: cafaFadeUp 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both; }
.cafa-brand  { animation: cafaFadeUp 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.30s both; }
`;

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation("auth");
  const { direction } = useLanguage();

  return (
    <>
      <style>{CSS}</style>
      <div dir={direction} className="relative min-h-screen overflow-x-hidden overflow-y-auto">
        <img
          src={fieldBg}
          alt=""
          aria-hidden
          className="cafa-bg-img absolute inset-0 h-full w-full object-cover object-[center_25%] sm:object-center"
        />
        <div className="absolute inset-0 bg-[#1E2D5B]/63" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(10,18,48,0.50) 100%)",
          }}
        />

        <main className="relative z-20 min-h-screen flex items-center px-6 py-16 sm:px-12 sm:py-24 lg:px-20">
          <div className="w-full max-w-5xl mx-auto flex items-center gap-12 lg:gap-24 flex-row">
            <div className="cafa-brand hidden lg:flex flex-col flex-1 text-white items-start text-start -mt-[88px]">
              <img
                src={cafaLogo}
                alt="CAFA Development Organisation"
                className="w-[148px] h-[148px] object-contain mb-7"
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/65 mb-3">
                {t("internalSystemLabel")}
              </p>
              <h1 className="text-[42px] font-bold leading-tight tracking-tight mb-3">
                CAFA PMIS
              </h1>
              <p className="text-sm text-white/70 max-w-[380px] leading-relaxed">
                {t("systemTagline")}
              </p>
            </div>

            <div className="cafa-card w-full max-w-[440px] shrink-0 rounded-2xl bg-white border border-gray-200 shadow-[0_12px_40px_rgba(0,0,0,0.16),0_2px_8px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="flex lg:hidden justify-center px-7 pt-7">
                <img src={cafaIcon} alt="CAFA" className="h-12 object-contain" />
              </div>
              {children}
            </div>
          </div>
        </main>

        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-5">
          <p className="text-white/50 text-[13px] tracking-wide">
            {t("copyright")}
          </p>
        </div>
      </div>
    </>
  );
}