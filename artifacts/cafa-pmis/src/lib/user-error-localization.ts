export const USER_API_ERROR_KEYS: Record<string, string> = {
  name_username_email_required: "nameUsernameEmailRequired",
  invalid_role: "invalidRole",
  state_required_for_state_role: "stateRequired",
  sector_required_for_technical_coordinator: "sectorRequired",
  invalid_sector: "invalidSector",
  email_already_exists: "emailExists",
  username_already_exists: "usernameExists",
  email_or_username_taken: "emailOrUsernameTaken",
  invalid_state: "invalidState",
  password_too_short: "passwordTooShort",
  password_too_weak: "passwordTooWeak",
  password_required: "passwordRequired",
  unique_constraint_violation: "uniqueConstraintViolation",
  foreign_key_violation: "foreignKeyViolation",
  required_field_null: "requiredFieldNull",
  db_error: "dbError",
  not_found: "notFound",
  user_already_active: "alreadyActive",
  user_not_invited: "notInvited",
  duplicate_active_invitation: "duplicateInvitation",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Presents server error codes through the active users locale, never raw API detail. */
export function localizeUserApiError(t: Translate, code: string): string {
  const key = USER_API_ERROR_KEYS[code];
  return key ? t(`errors.${key}`) : code ? t("errors.errorCode", { code }) : t("errors.failedToSave");
}