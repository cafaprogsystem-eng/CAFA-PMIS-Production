import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Controlled value */
  value?: string;
  onChange?: (value: string) => void;
  /** Show a clear (×) button when there is a value */
  clearable?: boolean;
  /** Extra wrapper className */
  wrapperClassName?: string;
}

/**
 * SearchInput — an Input with a leading search icon and an optional clear button.
 *
 * Usage:
 *   <SearchInput placeholder="Search…" value={q} onChange={setQ} clearable />
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      wrapperClassName,
      value = "",
      onChange,
      clearable = true,
      placeholder = "Search…",
      disabled,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation("common");
    const showClear = clearable && String(value).length > 0;
    const resolvedPlaceholder = placeholder ?? t("search");

    return (
      <div className={cn("relative flex items-center w-full", wrapperClassName)}>
        {/* Leading icon */}
        <Search
          className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none shrink-0"
          aria-hidden
        />

        <input
          ref={ref}
          type="search"
          role="searchbox"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className={cn(
            // base
            "flex h-9 w-full rounded-lg border border-input bg-card",
            "ps-9 pe-9 py-2 text-sm text-foreground shadow-sm",
            "placeholder:text-muted-foreground/60",
            // focus
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/50",
            // hover
            "hover:border-border/80",
            // disabled
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/30",
            // remove browser's default 'x' in search inputs
            "[&::-webkit-search-cancel-button]:appearance-none",
            "transition-all duration-150",
            className
          )}
          {...props}
        />

        {/* Clear button */}
        {showClear && (
          <button
            type="button"
            onClick={() => onChange?.("")}
            disabled={disabled}
            aria-label={t("clearSearch")}
            className={cn(
              "absolute end-2.5 top-1/2 -translate-y-1/2",
              "flex h-5 w-5 items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-accent",
              "transition-colors duration-100",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none"
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
