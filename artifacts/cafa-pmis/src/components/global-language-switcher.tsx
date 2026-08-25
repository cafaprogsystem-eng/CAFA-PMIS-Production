import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanguage, type Language } from "@/contexts/language-context";
import { Button } from "@/components/ui/button";
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
        <Button
          variant="ghost"
          size="icon"
          data-testid="global-language-switcher"
          aria-label={t("language.switch")}
          className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent/80"
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
        </Button>
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