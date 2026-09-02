/**
 * CAFA PMIS – Public Institutional Landing Page
 * Product captures are approved non-production screenshots and contain only
 * synthetic fixture data. See landing-screenshots.provenance.json.
 * No internal API calls are made from this page.
 * Auth state is received as a prop from AuthGate (no network request).
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Menu, X, ArrowRight,
  FolderKanban, CalendarCheck, BarChart3,
  Wallet, ShieldAlert, Files, BookOpen, Sparkles,
  Shield, HelpCircle, BookMarked,
  Search, Network, Check,
} from "lucide-react";
import cafaLogo from "@/assets/cafa-logo.png";
import cafaField from "@/assets/cafa-field.png";
import ssDashboard from "@/assets/landing-dashboard.webp";
import ssProjects from "@/assets/landing-projects.webp";
import ssPlans from "@/assets/landing-plans.webp";
import ssAiAssistant from "@/assets/landing-ai.webp";
import type { ComponentType } from "react";

// ── Content ────────────────────────────────────────────────────────────────────

const NAV_ANCHORS = [
  { key: "modules",  anchor: "#modules"  },
  { key: "features", anchor: "#features" },
  { key: "benefits", anchor: "#benefits" },
  { key: "support",  anchor: "#support"  },
];

interface ModuleItem {
  icon: ComponentType<{ className?: string }>;
  id: string;
  /** Tailwind gradient classes — bg-gradient-to-br from-X to-Y */
  color: string;
  badge?: "CORE" | "NEW" | "POPULAR" | "OPTIONAL";
}

// Gradient palette: blue / emerald / violet / amber — alternates across the row
const MODULES: ModuleItem[] = [
  {
    icon: FolderKanban,
    id: "projects",
    color: "bg-gradient-to-br from-blue-500 to-blue-700",
  },
  {
    icon: CalendarCheck,
    id: "planning",
    color: "bg-gradient-to-br from-emerald-400 to-emerald-600",
  },
  {
    icon: BarChart3,
    id: "reports",
    color: "bg-gradient-to-br from-violet-500 to-violet-700",
  },
  {
    icon: Wallet,
    id: "budgets",
    color: "bg-gradient-to-br from-amber-400 to-amber-600",
  },
  {
    icon: ShieldAlert,
    id: "risks",
    color: "bg-gradient-to-br from-blue-500 to-blue-700",
  },
  {
    icon: Files,
    id: "files",
    color: "bg-gradient-to-br from-emerald-400 to-emerald-600",
  },
  {
    icon: BookOpen,
    id: "manual",
    color: "bg-gradient-to-br from-violet-500 to-violet-700",
  },
  {
    icon: Sparkles,
    id: "ai",
    color: "bg-gradient-to-br from-amber-400 to-amber-600",
  },
];

// ── Benefit icons — Heroicons v2 Solid (24×24 viewBox, fill="currentColor") ───
interface BenefitItem {
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
  id: string;
}

/** Five benefits — Lucide outline icons, consistent 1.75 stroke weight */
const BENEFITS: BenefitItem[] = [
  {
    icon: FolderKanban,
    id: "projects",
  },
  {
    icon: Network,
    id: "coordination",
  },
  {
    icon: BarChart3,
    id: "progress",
  },
  {
    icon: Files,
    id: "approvals",
  },
  {
    icon: BookOpen,
    id: "resources",
  },
];


// ── Spacing tokens ─────────────────────────────────────────────────────────────
// All sections: py-10 lg:py-[4.5rem]  =  40 / 72 px  (−37% vs previous 64/120)
// Platform top: pt-12 lg:pt-[5.5rem]  =  48 / 88 px  (−37% vs previous 64/140)
// Showcase rows: py-8 lg:py-14        =  32 / 56 px
// Container: max-w-[1360px] px-6 sm:px-8 lg:px-16

// ── Helpers ────────────────────────────────────────────────────────────────────

function smoothScroll(anchor: string) {
  document.querySelector(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-wider text-primary mb-2 ${className ?? ""}`}>
      {children}
    </p>
  );
}

/**
 * ProductFrame — restrained screenshot wrapper.
 * The fixed aspect-ratio canvas reserves image space before loading and
 * object-contain preserves the source capture without cropping or stretching.
 */
interface HighlightChip { label: string; style: React.CSSProperties }

/**
 * The browser chrome is presentation-only; the image itself is a real capture.
 */
function ProductFrame({
  src, alt, priority = false, highlights = [],
}: {
  src: string;
  alt: string;
  priority?: boolean;
  highlights?: HighlightChip[];
}) {
  return (
    <div className="group select-none relative" data-testid="landing-product-frame">
      {/* Floating annotation chips — standardised: identical padding, radius, shadow, font */}
      {highlights.map(h => (
        <div
          key={h.label}
          className="absolute z-10 px-3 py-[6px] rounded-full text-[11px] font-semibold tracking-[0.01em] bg-white/97 border border-slate-200/80 shadow-[0_2px_8px_rgb(0_0_0/0.10),0_1px_2px_rgb(0_0_0/0.06)] text-slate-600 whitespace-nowrap pointer-events-none"
          style={h.style}
          aria-hidden="true"
        >
          {h.label}
        </div>
      ))}
      <div className="rounded-[22px] p-[10px] bg-muted/60 border border-border/80 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_4px_12px_rgb(0_0_0/0.05),0_14px_36px_rgb(0_0_0/0.06)] transition-shadow duration-500 group-hover:shadow-[0_1px_3px_rgb(0_0_0/0.04),0_6px_18px_rgb(0_0_0/0.07),0_20px_48px_rgb(0_0_0/0.09)]">
        <div className="rounded-[14px] overflow-hidden border border-border/80 bg-card">
          {/* Browser chrome */}
          <div className="h-8 bg-muted/70 border-b border-border/80 flex items-center gap-2.5 px-3 shrink-0">
            <div className="flex items-center gap-[5px] shrink-0">
              <div className="h-[9px] w-[9px] rounded-full bg-[#FF5F57]" aria-hidden="true" />
              <div className="h-[9px] w-[9px] rounded-full bg-[#FEBC2E]" aria-hidden="true" />
              <div className="h-[9px] w-[9px] rounded-full bg-[#28C840]" aria-hidden="true" />
            </div>
            <div className="flex-1 h-[18px] rounded-[4px] bg-card/80 border border-border/80 flex items-center px-2 gap-1.5 min-w-0">
              <div className="h-1.5 w-1.5 rounded-full bg-[#28C840] shrink-0" aria-hidden="true" />
              <span className="text-[9px] font-medium text-slate-400 leading-none truncate">
                app.cafa-pmis.org
              </span>
            </div>
          </div>
          {/* Fixed 16:9 canvas — letterbox is intentional and never distorts a capture. */}
          <div className="aspect-[16/9] bg-white overflow-hidden">
            <img
              src={src}
              alt={alt}
              className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-[1.006]"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              sizes="(min-width: 1024px) 64vw, 100vw"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Badge colour map — sparse: only POPULAR and NEW assigned */
const BADGE_STYLES: Record<string, string> = {
  CORE:     "bg-primary/[0.07] text-primary/80",
  POPULAR:  "bg-violet-50 text-violet-600",
  NEW:      "bg-emerald-50 text-emerald-600",
  OPTIONAL: "bg-slate-100 text-slate-400",
};

/**
 * ModuleCard — premium enterprise SaaS feature card.
 * 60px gradient icon · category label · 22px bold title · 3-line desc · pills.
 * Hover: 4px lift · stronger shadow · blue border · icon scale 105% · 250ms.
 */
function ModuleCard({ mod, delay = 0 }: { mod: ModuleItem; delay?: number }) {
  const { t } = useTranslation("landing");
  const Icon = mod.icon;
  return (
    <div
       className="relative landing-fade-in group flex flex-col h-full min-h-[238px] rounded-[20px] border border-card-border shadow-[0_1px_4px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] p-5 cursor-pointer transition-all duration-[250ms] hover:-translate-y-1 hover:shadow-[0_18px_48px_rgb(0_0_0/0.13),0_4px_14px_rgb(0_0_0/0.07)] hover:border-primary/40"
      style={{
         background: "linear-gradient(160deg, hsl(var(--card)) 0%, hsl(var(--muted) / 0.32) 100%)",
        ...(delay ? { transitionDelay: `${delay}ms` } : {}),
      }}
    >
      {/* Badge — absolute top-right pill */}
      {mod.badge && (
        <span className={`absolute top-3.5 end-3.5 px-2 py-[3px] text-[10px] font-medium tracking-widest uppercase rounded-full ${BADGE_STYLES[mod.badge]}`}>
          {mod.badge}
        </span>
      )}

      {/* Gradient icon circle — 60 px, scales on hover */}
      <div className={`${mod.color} h-[60px] w-[60px] rounded-full flex items-center justify-center shrink-0 mb-3 shadow-[0_2px_8px_rgb(0_0_0/0.14)] transition-transform duration-[250ms] group-hover:scale-105`}>
        <Icon className="h-[26px] w-[26px] text-white" aria-hidden="true" />
      </div>

      {/* Category label — 11px uppercase above title */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
        {t(`content.modules.${mod.id}.category`)}
      </p>

      {/* Module title — restrained card-title scale */}
      <p className="text-[20px] font-semibold text-foreground leading-snug tracking-tight mb-1.5">
        {t(`content.modules.${mod.id}.name`)}
      </p>

      {/* Description — max 3 lines */}
      <p className="text-[14px] text-muted-foreground leading-[1.7] min-h-[66px] mb-3">
        {t(`content.modules.${mod.id}.description`)}
      </p>

      {/* Capability pills — subtle, anchored to card bottom */}
      <div className="flex flex-wrap gap-1 mt-auto">
        {[0, 1, 2].map(index => (
          <span
            key={index}
            className="inline-block px-2 py-[4px] text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full leading-none"
          >
            {t(`content.modules.${mod.id}.tags.${index}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
/**
 * FeatureShowcase — four alternating-background feature rows.
 * Odd rows: #F8FAFC · Even rows: white — creates visual rhythm.
 * Screenshot 64 % · Text 36 % · Numbers 01–04 · Copy executive-focused.
 */
function FeatureShowcase() {
  const { t } = useTranslation("landing");
  const rows: Array<{
    id: string;
    num: string;
    src: string;
    imageRight: boolean;
    bg: string;
  }> = [
    {
      id: "dashboard",
      num: "01",
      src: ssDashboard,
      imageRight: true,
      bg: "#F8FAFC",
    },
    {
      id: "projects",
      num: "02",
      src: ssProjects,
      imageRight: false,
      bg: "#ffffff",
    },
    {
      id: "programme",
      num: "03",
      src: ssPlans,
      imageRight: true,
      bg: "#F8FAFC",
    },
    {
      id: "ai",
      num: "04",
      src: ssAiAssistant,
      imageRight: false,
      bg: "#ffffff",
    },
  ];

  return (
    <section
      id="features"
      className="scroll-mt-16"
      aria-labelledby="features-heading"
    >
      {/* ── Section introduction ── */}
      <div className="bg-background">
        <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16 pt-16 pb-4 lg:pt-24 lg:pb-5">
          <div className="landing-fade-in max-w-[720px]">
            <Eyebrow className="mb-4">{t("features.sectionLabel")}</Eyebrow>
            <h2
              id="features-heading"
              className="text-[36px] sm:text-[44px] lg:text-[52px] font-bold tracking-[-0.03em] leading-[1.08] text-foreground mb-5"
            >
              {t("content.featureHeading")}
            </h2>
            <p className="text-[20px] leading-[1.7] text-muted-foreground">
              {t("features.description")}
            </p>
          </div>
        </div>
      </div>

      {/* ── Feature rows — each is a full-width band with its own background ── */}
      {rows.map((row, i) => {
        const isFirst = i === 0;

        // Text panel: number → category → title → description
        const textPanel = (
          <div className="flex flex-col justify-center">
            {/* Sequential number — slightly larger, reduced opacity for elegant design element */}
            <p className="text-[16px] font-mono font-medium tracking-[0.12em] text-slate-300/70 mb-1 select-none">
              {row.num}
            </p>
            {/* Category label — standardised: 12px semibold uppercase 0.09em spacing */}
            <p className="text-[12px] font-semibold uppercase tracking-[0.09em] text-[#6b7fa3] mb-2.5">
              {t(`content.featuresContent.${row.id}.category`)}
            </p>
            {/* Title — extrabold for premium weight */}
            <h3 className="text-[30px] sm:text-[34px] font-bold tracking-[-0.024em] leading-[1.12] text-foreground mb-3">
              {t(`content.featuresContent.${row.id}.title`)}
            </h3>
            {/* Description — capped at ~60 chars per line for readability */}
            <p className="text-[18px] leading-[1.75] text-muted-foreground max-w-[42ch]">
              {t(`content.featuresContent.${row.id}.description`)}
            </p>
          </div>
        );

        // Image fires first (delay 0); text follows 120ms later.
        const imageCol = (
          <div className="landing-fade-in" style={{ transitionDelay: "0ms" }}>
            <ProductFrame
              src={row.src}
              alt={t(`content.featuresContent.${row.id}.alt`)}
              priority={isFirst}
            />
          </div>
        );
        const textCol = (
          <div className="landing-fade-in" style={{ transitionDelay: "120ms" }}>
            {textPanel}
          </div>
        );

        return (
          <div
            key={row.id}
            style={{ backgroundColor: row.bg }}
            className="border-t border-border/40"
          >
            <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16 py-[60px] lg:py-[70px]">
              <div
                className={`grid grid-cols-1 items-center gap-8 lg:gap-[76px] ${
                  row.imageRight
                    ? "lg:grid-cols-[36fr_64fr]"
                    : "lg:grid-cols-[64fr_36fr]"
                }`}
              >
                {row.imageRight ? (
                  <>
                    {textCol}
                    {imageCol}
                  </>
                ) : (
                  <>
                    {/* Mobile: image renders below text; desktop: image in col-1 */}
                    <div className="order-2 lg:order-1">{imageCol}</div>
                    <div className="order-1 lg:order-2">{textCol}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { t } = useTranslation("landing");
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen]       = useState(false);
  const [scrolled, setScrolled]           = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".landing-fade-in");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add("is-visible");
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.06, rootMargin: "0px 0px -24px 0px" },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Scroll-spy — tracks which section is at/above the top 64 px of the viewport
  useEffect(() => {
    const ids = NAV_ANCHORS.map(n => n.anchor.slice(1));
    const handle = () => {
      const offset = 72;
      let current = "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", handle, { passive: true });
    handle();
    return () => window.removeEventListener("scroll", handle);
  }, []);

  const handlePrimary = () => setLocation("/login");
  const handleAnchor  = (anchor: string) => {
    setMobileOpen(false);
    setTimeout(() => smoothScroll(anchor), mobileOpen ? 150 : 0);
  };
  const ctaLabel = t("hero.ctaPrimary");

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[9999] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        {t("content.skipToContent")}
      </a>

      <div className="min-h-screen bg-background text-foreground flex flex-col">

        {/* ══════════════════════════════════════════════════════════════
            HEADER — sticky 56 px
        ══════════════════════════════════════════════════════════════ */}
        <header
          className={`sticky top-0 z-50 border-b border-border transition-all duration-200 ${scrolled ? "bg-white/95 backdrop-blur-sm shadow-sm" : "bg-white"}`}
          role="banner"
        >
          <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16">
            <div className="flex items-center justify-between h-14">

              <a
                href="/"
                className="flex items-center gap-2.5 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("content.homeAriaLabel")}
              >
                <img src={cafaLogo} alt="" className="h-7 w-auto" width={28} height={28} aria-hidden="true" />
                <div className="leading-none">
                  <span className="text-base font-semibold text-foreground block tracking-tight">CAFA PMIS</span>
                  <span className="text-[10px] text-muted-foreground hidden sm:block leading-none mt-0.5">
                    Programme Management Information System
                  </span>
                </div>
              </a>

              <nav className="hidden lg:flex items-center" aria-label={t("content.siteNavigation")}>
                {NAV_ANCHORS.map(n => {
                  const isActive = activeSection === n.anchor.slice(1);
                  return (
                    <button
                      key={n.key}
                      onClick={() => handleAnchor(n.anchor)}
                         className={`relative px-[18px] py-2 text-[13px] font-medium tracking-[0.02em] rounded transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground hover:text-primary"
                      }`}
                    >
                      {t(`nav.${n.key}`, n.key)}
                      <span
                        className={`absolute bottom-0 start-[18px] end-[18px] h-[2px] rounded-full bg-primary transition-opacity duration-200 ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </nav>

              <div className="hidden lg:flex">
                <button
                  type="button"
                  onClick={handlePrimary}
                  className="group inline-flex items-center justify-center gap-2 h-11 px-6 text-[15px] font-semibold rounded-xl bg-primary text-primary-foreground shadow-[0_1px_3px_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.06)] hover:bg-primary/90 hover:-translate-y-px hover:shadow-[0_4px_14px_rgb(0_0_0/0.18)] active:translate-y-px transition-all duration-[220ms] ease-out whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4 transition-transform duration-[220ms] ease-out group-hover:translate-x-[3px] rtl:group-hover:-translate-x-[3px] rtl:rotate-180" aria-hidden="true" />
                </button>
              </div>

              <div className="flex lg:hidden items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrimary}
                  className="inline-flex items-center justify-center gap-1.5 h-9 px-4 text-sm font-semibold rounded-lg border border-border text-foreground hover:bg-muted transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ctaLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setMobileOpen(v => !v)}
                  aria-expanded={mobileOpen}
                  aria-label={mobileOpen ? t("content.closeNavigation") : t("content.openNavigation")}
                  className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {mobileOpen
                    ? <X className="h-5 w-5" aria-hidden="true" />
                    : <Menu className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>
          </div>

          {mobileOpen && (
            <div className="lg:hidden border-t border-border bg-white px-4 py-3 space-y-0.5">
              {NAV_ANCHORS.map(n => (
                <button
                  key={n.key}
                  onClick={() => handleAnchor(n.anchor)}
                   className={`w-full text-start px-3 py-2.5 text-[13px] font-medium tracking-[0.02em] hover:bg-muted rounded transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    activeSection === n.anchor.slice(1)
                      ? "text-primary"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  {t(`nav.${n.key}`, n.key)}
                </button>
              ))}
            </div>
          )}
        </header>

        <main id="main-content" className="flex-1">

          {/* ══════════════════════════════════════════════════════════════
              HERO — Minimal, image-focused, no buttons
          ══════════════════════════════════════════════════════════════ */}
          <section aria-labelledby="hero-heading" className="relative overflow-hidden" style={{ minHeight: "540px" }}>

            {/* Background image + lighter left-to-right gradient */}
            <div className="absolute inset-0 z-0" aria-hidden="true">
              <img
                src={cafaField}
                alt=""
                className="w-full h-full object-cover object-center"
                fetchPriority="high"
                width={1920}
                height={540}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0d1b3a]/82 via-[#0d1b3a]/38 to-transparent" />
            </div>

            {/* Content — vertically centred, left-aligned */}
            <div
              className="relative z-10 max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16 flex items-center"
              style={{ minHeight: "540px" }}
            >
              <div className="py-20">

                {/* Small label */}
                <p
                  className="landing-fade-in text-[11px] font-semibold uppercase text-white/55 mb-6"
                  style={{ letterSpacing: "0.18em" }}
                >
                  {t("hero.eyebrow")}
                </p>

                {/* Heading — balanced two lines */}
                <h1
                  id="hero-heading"
                   className="landing-fade-in text-[40px] sm:text-[52px] lg:text-[60px] 2xl:text-[68px] font-bold tracking-[-0.025em] leading-[1.04] text-white mb-7 max-w-[900px]"
                  style={{ transitionDelay: "60ms" }}
                >
                  {t("hero.title")}
                </h1>

                {/* Description */}
                <p
                  className="landing-fade-in text-[18px] leading-[1.55] text-white/85 max-w-[640px]"
                  style={{ transitionDelay: "120ms" }}
                >
                  {t("hero.description")}
                </p>

              </div>
            </div>

          </section>

          {/* ══════════════════════════════════════════════════════════════
              MODULES — #F8FAFC · 5-column premium feature card grid
          ══════════════════════════════════════════════════════════════ */}
          <section
            id="modules"
            className="relative bg-[#F8FAFC] border-t border-border scroll-mt-16 pt-[60px] pb-9 lg:pt-[72px] lg:pb-10"
            aria-labelledby="modules-heading"
          >
            {/* ~300px card width: max-w-1500 + minimal lg padding + gap-x-4 */}
            <div className="max-w-[1500px] mx-auto px-6 sm:px-8 lg:px-4">
              <div className="mb-6 text-center landing-fade-in">
                <Eyebrow className="mb-1">{t("modules.sectionLabel")}</Eyebrow>
                <h2
                  id="modules-heading"
                   className="text-[36px] sm:text-[44px] lg:text-[48px] font-bold tracking-[-0.025em] leading-[1.1] text-foreground mb-2"
                >
                  {t("modules.title")}
                </h2>
                <p className="text-base text-muted-foreground leading-[1.7] max-w-[640px] mx-auto">
                  {t("modules.subtitle")}
                </p>
              </div>

              {/*
                Row 1: 5 cards across all columns.
                Row 2: 3 cards centred — col-start-2 shifts them to cols 2,3,4.
                gap-x-4 (16px) horizontal; gap-y-6 (24px) vertical between rows.
              */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-6 items-stretch [grid-auto-rows:1fr]">
                {MODULES.map((mod, i) => (
                   <div key={mod.id} className={`h-full${i === 5 ? " lg:col-start-2" : ""}`}>
                    <ModuleCard mod={mod} delay={i * 50} />
                  </div>
                ))}
              </div>
            </div>

            {/* Soft gradient fade — eases the Modules → Features boundary */}
            <div
              className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
              style={{ background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.55))" }}
              aria-hidden="true"
            />
          </section>

          <FeatureShowcase />

          {/* ══════════════════════════════════════════════════════════════
              BENEFITS — Slate-50 · 5-column icon + text, no cards
          ══════════════════════════════════════════════════════════════ */}
          <section
            id="benefits"
             className="bg-slate-50 scroll-mt-16 py-16 lg:py-[72px]"
            aria-labelledby="benefits-heading"
          >
            <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16">

              {/* ── Centred section header ── */}
              <div className="landing-fade-in text-center mb-12">
                <Eyebrow className="justify-center mb-3">{t("benefits.sectionLabel")}</Eyebrow>
                <h2
                  id="benefits-heading"
                   className="text-[32px] sm:text-[38px] font-bold tracking-[-0.025em] leading-[1.12] text-foreground mb-3"
                >
                  {t("benefits.title")}
                </h2>
                <p className="text-[17px] text-muted-foreground leading-[1.7] max-w-[760px] mx-auto">
                  {t("content.benefitsIntro")}
                </p>
              </div>

              {/* ── True 5-column grid — no wrapping on desktop ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-10">
                {BENEFITS.map((b, i) => {
                  const Icon = b.icon;
                  return (
                    <div
                      key={b.id}
                      className="landing-fade-in flex flex-col items-center text-center"
                      style={{ transitionDelay: `${i * 80}ms` }}
                    >
                      {/* Outline icon — consistent stroke weight, primary colour, no container */}
                      <Icon
                        className="h-14 w-14 text-primary mb-[18px] shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      {/* Benefit title */}
                      <p className="text-[20px] font-semibold text-foreground leading-snug mb-3">
                        {t(`content.benefitsContent.${b.id}.title`)}
                      </p>
                      {/* Supporting description */}
                      <p className="text-[16px] text-muted-foreground leading-[1.6]">
                        {t(`content.benefitsContent.${b.id}.description`)}
                      </p>
                    </div>
                  );
                })}
              </div>

            </div>
          </section>

          {/* ══════════════════════════════════════════════════════════════
              SUPPORT — White · centred header / two-column: features left / help-centre mockup right
          ══════════════════════════════════════════════════════════════ */}
          <section
            id="support"
             className="bg-white border-t border-border scroll-mt-16 pt-16 lg:pt-[72px] pb-20 lg:pb-[88px]"
            aria-labelledby="support-heading"
          >
            <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16">
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-12 lg:gap-16 items-center">

                {/* ── Left (~40%): heading + compact checklist + subtle text link ── */}
                <div className="landing-fade-in flex flex-col">
                  <Eyebrow className="mb-4">{t("support.sectionLabel")}</Eyebrow>
                  <h2
                    id="support-heading"
                     className="text-[32px] sm:text-[38px] font-bold tracking-[-0.025em] leading-[1.12] text-foreground mb-4"
                  >
                    {t("support.title")}
                  </h2>
                  <p className="text-[17px] leading-[1.7] text-muted-foreground mb-8">
                    {t("support.subtitle")}
                  </p>

                  {/* Compact checklist — title only, no descriptions */}
                  <ul className="space-y-4 mb-8">
                    {[0, 1, 2, 3].map(index => (
                      (() => {
                        const item = t(`content.supportChecklist.${index}`);
                        return (
                      <li key={item} className="flex items-center gap-3">
                        <div className="h-6 w-6 rounded-full border border-primary/30 flex items-center justify-center shrink-0">
                          <Check className="h-3 w-3 text-primary" aria-hidden="true" />
                        </div>
                        <span className="text-[15px] font-medium text-foreground">{item}</span>
                      </li>
                        );
                      })()
                    ))}
                  </ul>

                  {/* Subtle text link — no primary button */}
                  <a
                    href="/login"
                    className="inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline underline-offset-2 transition-all duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t("support.exploreLink")}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
                  </a>
                </div>

                {/* ── Right: Help Centre browser mockup (decorative JSX, aria-hidden) ── */}
                <div
                  className="landing-fade-in rounded-[20px] border border-slate-200 bg-white overflow-hidden shadow-[0_4px_24px_rgb(0_0_0/0.07),0_1px_4px_rgb(0_0_0/0.04)]"
                  style={{ transitionDelay: "120ms" }}
                  aria-hidden="true"
                >
                  {/* Browser chrome */}
                  <div className="bg-[#F0F2F5] border-b border-slate-200 px-4 py-[9px] flex items-center gap-3">
                    <div className="flex gap-1.5 shrink-0">
                      <div className="h-[9px] w-[9px] rounded-full bg-[#FF5F57]" />
                      <div className="h-[9px] w-[9px] rounded-full bg-[#FFBD2E]" />
                      <div className="h-[9px] w-[9px] rounded-full bg-[#28C840]" />
                    </div>
                    <div className="flex-1 bg-white rounded border border-slate-200/80 px-3 py-[3px] flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                      <span className="text-[10px] text-slate-400 font-medium truncate">app.cafa-pmis.org/manual</span>
                    </div>
                  </div>

                  {/* Help Centre content */}
                  <div className="bg-white">

                    {/* Primary header with search */}
                    <div className="bg-primary px-5 py-4">
                      <p className="text-white text-[12px] font-semibold mb-0.5 opacity-90">{t("content.helpMockup.title")}</p>
                      <p className="text-white/65 text-[10px] mb-3">{t("content.helpMockup.subtitle")}</p>
                      <div className="bg-white rounded-lg border border-slate-200 px-3 py-[7px] flex items-center gap-2 shadow-sm">
                        <Search className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
                        <span className="text-[10px] text-slate-400 select-none">{t("content.helpMockup.search")}</span>
                      </div>
                    </div>

                    {/* Category grid */}
                    <div className="px-4 pt-4 pb-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.09em] text-slate-400 mb-2.5">{t("content.helpMockup.browse")}</p>
                      <div className="grid grid-cols-3 gap-2 mb-2.5">
                        {[
                          BookOpen, BookMarked, Files, HelpCircle, Shield, Sparkles,
                        ].map((Icon, index) => {
                          const label = t(`content.helpMockup.categories.${index}.label`);
                          const description = t(`content.helpMockup.categories.${index}.description`);
                          return (
                            <div
                              key={label}
                              className="rounded-lg border border-slate-100 bg-slate-50/80 p-2 flex flex-col items-center text-center gap-1 cursor-default group hover:border-primary/20 hover:bg-primary/[0.03] transition-colors duration-150"
                            >
                              <div className="h-7 w-7 rounded-md bg-primary/[0.08] flex items-center justify-center group-hover:bg-primary/[0.13] transition-colors">
                                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                              </div>
                              <p className="text-[9.5px] font-semibold text-foreground leading-tight">{label}</p>
                              <p className="text-[8.5px] text-slate-400 leading-tight">{description}</p>
                            </div>
                          );
                        })}
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </div>
          </section>

        </main>

        {/* ══════════════════════════════════════════════════════════════
            FOOTER — Deep professional blue gradient
        ══════════════════════════════════════════════════════════════ */}
        <footer
          className="text-white/80"
          style={{ background: "linear-gradient(to bottom, #34506D 0%, #2E4A62 100%)" }}
          role="contentinfo"
        >
          <div className="max-w-[1360px] mx-auto px-6 sm:px-8 lg:px-16 py-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">

              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <img
                    src={cafaLogo}
                    alt="CAFA"
                    className="h-9 w-auto"
                    width={36}
                    height={36}
                    style={{ filter: "brightness(0) invert(1)", opacity: 0.92 }}
                  />
                  <div>
                    <p className="text-[15px] font-semibold text-white tracking-tight">CAFA PMIS</p>
                    <p className="text-xs text-white/60 leading-none mt-0.5">{t("footer.system")}</p>
                  </div>
                </div>
                <p className="text-sm text-white/65 leading-relaxed">
                  {t("footer.tagline")}
                </p>
              </div>

              <nav aria-label={t("common:landingFooter.platformNav")}>
                <p className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-3">{t("footer.platformNav")}</p>
                <ul className="space-y-2">
                  {[
                    { key: "modules",  anchor: "#modules"  },
                    { key: "features", anchor: "#features" },
                    { key: "benefits", anchor: "#benefits" },
                    { key: "support",  anchor: "#support"  },
                  ].map(l => (
                    <li key={l.key}>
                      <button
                        type="button"
                        onClick={() => smoothScroll(l.anchor)}
                        className="text-sm text-white/75 hover:text-white hover:translate-x-0.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
                      >
                        {t(`nav.${l.key}`, l.key)}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <nav aria-label={t("common:landingFooter.legalNav")}>
                <p className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-3">{t("footer.legalNav")}</p>
                <ul className="space-y-2">
                  {[
                    { key: "systemManual", href: "/manual", ext: false },
                  ].map(l => (
                    <li key={l.key}>
                      <a
                        href={l.href}
                        {...(l.ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className="text-sm text-white/75 hover:text-white hover:translate-x-0.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
                      >
                        {t(`footer.links.${l.key}`, l.key)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.15]">
              <p className="text-xs text-white/55">
                &copy; {new Date().getFullYear()} {t("footer.copyright")}
              </p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
