import { Check, Globe } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { useLanguage, type Language } from "@/contexts/language-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Keeps the language preference reachable from every authenticated page,
 * regardless of whether the sidebar or account menu is currently visible.
 */
export function GlobalLanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation("nav");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* HeroUI Pro Navbar.Item styling (the trigger stays a Radix one). */}
        <button
          type="button"
          data-testid="global-language-switcher"
          aria-label={t("language.switch")}
          className="navbar__item"
        >
          <Globe className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {(["en", "ar"] as Language[]).map((code) => (
          <DropdownMenuItem
            key={code}
            data-testid={`global-language-${code}`}
            onSelect={() => setLang(code)}
            className="cursor-pointer gap-2"
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} />
            {code === "en" ? t("language.en") : t("language.ar")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}