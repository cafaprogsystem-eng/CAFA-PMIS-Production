import { useTranslation } from "react-i18next";

export interface LocalizableState {
  name: string;
  nameAr?: string | null;
}

/** Returns the server-owned State name for the active locale, with English fallback. */
export function getStateLabel(state: LocalizableState, language?: string): string {
  return language?.toLowerCase().startsWith("ar")
    ? state.nameAr?.trim() || state.name
    : state.name;
}

/**
 * Localises a linked-State payload. Linked records retain both names so an
 * inactive State can still be displayed without becoming an operational option.
 */
export function getLinkedStateLabel(
  state: { stateName?: string | null; stateNameAr?: string | null },
  language?: string,
): string {
  return getStateLabel({
    name: state.stateName?.trim() || "—",
    nameAr: state.stateNameAr,
  }, language);
}

/** Locale-aware display label for a server-owned State record. */
export function StateLabel({ state }: { state: LocalizableState }) {
  const { i18n } = useTranslation();
  return <>{getStateLabel(state, i18n?.resolvedLanguage ?? i18n?.language)}</>;
}