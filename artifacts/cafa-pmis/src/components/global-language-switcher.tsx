import { Dropdown, type Key } from "@heroui/react";
import { Button as AriaButton } from "react-aria-components";
import { Check, Globe } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { useLanguage, type Language } from "@/contexts/language-context";

/**
 * Keeps the language preference reachable from every authenticated page,
 * regardless of whether the sidebar or account menu is currently visible.
 */
export function GlobalLanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation("nav");

  return (
    <Dropdown>
      {/* A bare React Aria button keeps the Pro Navbar.Item look of its neighbours. */}
      <AriaButton data-testid="global-language-switcher" aria-label={t("language.switch")} className="navbar__item">
        <Globe className="size-4" aria-hidden="true" />
      </AriaButton>
      <Dropdown.Popover placement="bottom end" className="min-w-40">
        <Dropdown.Menu aria-label={t("language.switch")} onAction={(key: Key) => setLang(String(key) as Language)}>
          {(["en", "ar"] as Language[]).map((code) => {
            const label = code === "en" ? t("language.en") : t("language.ar");
            return (
              <Dropdown.Item key={code} id={code} textValue={label} data-testid={`global-language-${code}`}>
                <Check className={`size-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                <span lang={code}>{label}</span>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
