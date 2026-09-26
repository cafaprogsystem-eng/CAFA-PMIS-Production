import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Lock } from "lucide-react";
import { FieldError, InputGroup, Label, TextField, ToggleButton } from "@heroui/react";

type PasswordFieldProps = {
  /** Also the input's id, so the visibility toggle can point at it. */
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  isDisabled?: boolean;
  isInvalid?: boolean;
  /** Shown under the field while it is invalid, linked for screen readers. */
  errorMessage?: ReactNode;
  /** Extra content under the field, e.g. a strength meter. */
  children?: ReactNode;
};

/**
 * HeroUI password input with a lock prefix and a keyboard-reachable
 * show/hide toggle (aria-pressed via ToggleButton). The value stays ltr in
 * Arabic pages; index.css keeps its padding correct in both directions.
 */
export function PasswordField({
  id, label, value, onChange, autoComplete, isDisabled, isInvalid, errorMessage, children,
}: PasswordFieldProps) {
  const { t } = useTranslation("auth");
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      id={id}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      fullWidth
    >
      <Label>{label}</Label>
      <InputGroup fullWidth>
        <InputGroup.Prefix>
          <Lock className="h-4 w-4" />
        </InputGroup.Prefix>
        <InputGroup.Input dir="ltr" placeholder="••••••••" />
        <InputGroup.Suffix>
          <ToggleButton
            isIconOnly
            size="sm"
            variant="ghost"
            isSelected={visible}
            onChange={setVisible}
            aria-label={visible ? t("hidePassword") : t("showPassword")}
            aria-controls={id}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </ToggleButton>
        </InputGroup.Suffix>
      </InputGroup>
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
      {children}
    </TextField>
  );
}
