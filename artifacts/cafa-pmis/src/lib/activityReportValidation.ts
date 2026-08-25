/**
 * activityReportValidation.ts
 *
 * Unified, framework-agnostic validation domain for Activity Reports.
 * No React, no hooks, no fetch, no router — pure TypeScript functions
 * that can be imported by the component, step navigation, and tests alike.
 *
 * FIX-08: Replaces four independent divergent validation layers with a single
 * source of truth that is shared between the Submission Readiness panel,
 * validateSubmit, per-step Next navigation, and backend content gating.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationError = {
  step: number;   // 1–6 matching wizard step order
  field: string;  // camelCase field key matching form / sectionValues key
  code: string;   // stable error code e.g. "required", "date_order", "negative", "decimal"
  message: string; // User-facing British English message
};

export type ActivityValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  errorsByStep: Record<number, ValidationError[]>;
  firstInvalidStep: number | null;
  firstInvalidField: string | null;
};

export type ActivityValidationContext = {
  compatProfile: {
    subjectRequired: boolean;
    implementationSummaryRequired: boolean;
    resultsRequired: boolean;
    lessonsRequired: boolean;
    explicitBeneficiaryToggle: boolean;
    explicitChallengeToggle: boolean;
  };
  linkMode: "standalone" | "activity" | "project";
  locationType: "state" | "hq";
  singleStateUser: boolean;
  /**
   * True when the stored period string does not match YYYY-MM format
   * (i.e. the record predates the modern month/year period format).
   * Derived from editingReport.period in the component; never from form values.
   */
  isLegacyPeriod: boolean;
};

// ---------------------------------------------------------------------------
// Form value type (subset of FormShape + ActivityId for linking)
// ---------------------------------------------------------------------------

export type ActivityFormValues = {
  title?: string;
  activityName?: string;
  activityId?: number | null;
  projectId?: number | null;
  stateId?: number | null;
  reportingMonth?: string | number;
  reportingYear?: string | number;
  periodStart?: string;
  onDemandReason?: string;
  kind?: string;
  beneficiariesMale?: number | string;
  beneficiariesFemale?: number | string;
  beneficiariesBoys?: number | string;
  beneficiariesGirls?: number | string;
};

// ---------------------------------------------------------------------------
// Step 1 — Basic Information
// ---------------------------------------------------------------------------

export function validateActivityBasicInfo(
  values: ActivityFormValues,
  ctx: ActivityValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!(values.title ?? "").trim()) {
    errors.push({ step: 1, field: "title", code: "required", message: "Report Title is required." });
  }

  if (ctx.compatProfile.subjectRequired && !(values.activityName ?? "").trim()) {
    errors.push({ step: 1, field: "activityName", code: "required", message: "Report Subject / Activity Name is required." });
  }

  if (ctx.linkMode === "activity" && !values.activityId) {
    errors.push({ step: 1, field: "activityId", code: "required", message: "An Activity must be linked." });
  }

  if (ctx.linkMode === "project" && !values.projectId) {
    errors.push({ step: 1, field: "projectId", code: "required", message: "A Project must be linked." });
  }

  if (!values.stateId && !ctx.singleStateUser && ctx.locationType !== "hq") {
    errors.push({ step: 1, field: "stateId", code: "required", message: "State is required." });
  }

  // Legacy Activity Reports have a locked stored period — month/year fields are hidden and
  // not user-editable, so do not require them.
  if (!ctx.isLegacyPeriod) {
    const month = values.reportingMonth;
    const year  = values.reportingYear;
    // reportingMonth/reportingYear are numbers from the form; 0 / falsy means unset.
    if (!month || String(month) === "0") {
      errors.push({ step: 1, field: "reportingMonth", code: "required", message: "Reporting Month is required." });
    }
    if (!year || String(year) === "0") {
      errors.push({ step: 1, field: "reportingYear", code: "required", message: "Reporting Year is required." });
    }
  }

  // On-demand specific fields (only when kind is on_demand and period is not legacy-locked)
  if ((values.kind ?? "") === "on_demand" && !ctx.isLegacyPeriod) {
    if (!(values.periodStart ?? "").trim()) {
      errors.push({ step: 1, field: "periodStart", code: "required", message: "Period Start is required for On-Demand reports." });
    }
    if (!(values.onDemandReason ?? "").trim()) {
      errors.push({ step: 1, field: "onDemandReason", code: "required", message: "Reason for On-Demand is required." });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Step 2 — Implementation Progress
// ---------------------------------------------------------------------------

export function validateActivityImplementation(
  sectionValues: Record<string, string>,
  ctx: ActivityValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (ctx.compatProfile.implementationSummaryRequired) {
    if (!(sectionValues["implementationStatus"] ?? "").trim()) {
      errors.push({ step: 2, field: "implementationStatus", code: "required", message: "Implementation Status is required." });
    }
    if (!(sectionValues["implementationSummary"] ?? "").trim()) {
      errors.push({ step: 2, field: "implementationSummary", code: "required", message: "Implementation Summary is required." });
    }
  }

  // Date cross-validation: Actual End Date must be ≥ Actual Start Date (applies always when both present)
  const startDate = (sectionValues["actualStartDate"] ?? "").trim();
  const endDate   = (sectionValues["actualEndDate"]   ?? "").trim();
  if (startDate && endDate && endDate < startDate) {
    errors.push({ step: 2, field: "actualEndDate", code: "date_order", message: "Actual End Date must be on or after Actual Start Date." });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Step 3 — Results & Beneficiaries
// ---------------------------------------------------------------------------

function validateBeneficiaryCount(
  rawValue: number | string | undefined,
  field: string,
): ValidationError | null {
  const str = String(rawValue ?? "").trim();
  // Empty = 0, which is valid
  if (!str || str === "0") return null;
  const n = Number(str);
  if (isNaN(n)) {
    return { step: 3, field, code: "non_numeric", message: "Beneficiary counts must be whole numbers." };
  }
  if (!Number.isInteger(n)) {
    return { step: 3, field, code: "decimal", message: "Beneficiary counts must be whole numbers." };
  }
  if (n < 0) {
    return { step: 3, field, code: "negative", message: "Beneficiary counts must be zero or a positive whole number." };
  }
  return null;
}

export function validateActivityResults(
  sectionValues: Record<string, string>,
  values: Pick<ActivityFormValues, "beneficiariesMale" | "beneficiariesFemale" | "beneficiariesBoys" | "beneficiariesGirls">,
  ctx: ActivityValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (ctx.compatProfile.resultsRequired && !(sectionValues["resultsAchieved"] ?? "").trim()) {
    errors.push({ step: 3, field: "resultsAchieved", code: "required", message: "Results Achieved is required." });
  }

  if (ctx.compatProfile.explicitBeneficiaryToggle) {
    const reach = sectionValues["hasBeneficiaryReach"];
    // Only require the toggle if it has not been explicitly set
    if (reach !== "yes" && reach !== "no") {
      errors.push({ step: 3, field: "hasBeneficiaryReach", code: "required", message: "Please indicate whether this report has direct beneficiary reach." });
    } else if (reach === "yes") {
      // Validate beneficiary counts
      const countFields: Array<[keyof typeof values, string]> = [
        ["beneficiariesMale",   "beneficiariesMale"],
        ["beneficiariesFemale", "beneficiariesFemale"],
        ["beneficiariesBoys",   "beneficiariesBoys"],
        ["beneficiariesGirls",  "beneficiariesGirls"],
      ];
      for (const [key, field] of countFields) {
        const err = validateBeneficiaryCount(values[key], field);
        if (err) errors.push(err);
      }
    }
  }
  // Legacy (explicitBeneficiaryToggle=false): do not require toggle; FIX-07 governs

  return errors;
}

// ---------------------------------------------------------------------------
// Step 4 — Challenges & Actions
// ---------------------------------------------------------------------------

export function validateActivityChallenges(
  sectionValues: Record<string, string>,
  ctx: ActivityValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (ctx.compatProfile.explicitChallengeToggle) {
    const hasChallenges = sectionValues["hasChallenges"];
    if (hasChallenges !== "yes" && hasChallenges !== "no") {
      errors.push({ step: 4, field: "hasChallenges", code: "required", message: "Please indicate whether significant challenges were encountered." });
    } else if (hasChallenges === "yes") {
      // The challenges field in SECTIONS is keyed as "challenges" (displayed as "Challenges Encountered")
      if (!(sectionValues["challenges"] ?? "").trim()) {
        errors.push({ step: 4, field: "challenges", code: "required", message: "Challenges Encountered is required." });
      }
    }
  }
  // Legacy (explicitChallengeToggle=false): FIX-07 alias mapping; do not require toggle

  return errors;
}

// ---------------------------------------------------------------------------
// Step 5 — Lessons & Recommendations
// ---------------------------------------------------------------------------

export function validateActivityLessons(
  sectionValues: Record<string, string>,
  ctx: ActivityValidationContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // lessonsLearned required only for modern records
  if (ctx.compatProfile.lessonsRequired && !(sectionValues["lessonsLearned"] ?? "").trim()) {
    errors.push({ step: 5, field: "lessonsLearned", code: "required", message: "Lessons Learned is required." });
  }

  // recommendations, successStory, coordinationUpdates, communityFeedback are all optional
  // — never required at the validation layer.

  return errors;
}

// ---------------------------------------------------------------------------
// Step 6 — Attachments & Voice (transient state only)
// ---------------------------------------------------------------------------

export type ActivityAttachmentState = {
  uploadsInProgress: boolean;
  voiceNoteInProgress: boolean;
};

export function validateActivityAttachments(
  state: ActivityAttachmentState,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (state.uploadsInProgress) {
    errors.push({ step: 6, field: "uploads", code: "upload_in_progress", message: "Please wait for uploads to complete before submitting." });
  }
  if (state.voiceNoteInProgress) {
    errors.push({ step: 6, field: "voiceNote", code: "upload_in_progress", message: "Voice note upload is in progress. Please wait or retry." });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Aggregate: Full submission validator
// ---------------------------------------------------------------------------

/**
 * Validates all steps 1–6 for final submission of an Activity Report.
 * Calls each step validator in order and aggregates results.
 *
 * This is the single source of truth used by:
 *   - validateSubmit() in reports.tsx (final submit gate)
 *   - The Submission Readiness IIFE in the Step 6 sidebar
 *   - Per-step Next navigation handlers
 *
 * validateDraft() in reports.tsx remains separate and intentionally permissive.
 */
export function validateActivityForSubmission(
  values: ActivityFormValues,
  sectionValues: Record<string, string>,
  ctx: ActivityValidationContext,
  attachmentState?: ActivityAttachmentState,
): ActivityValidationResult {
  const allErrors: ValidationError[] = [
    ...validateActivityBasicInfo(values, ctx),
    ...validateActivityImplementation(sectionValues, ctx),
    ...validateActivityResults(sectionValues, values, ctx),
    ...validateActivityChallenges(sectionValues, ctx),
    ...validateActivityLessons(sectionValues, ctx),
    ...(attachmentState ? validateActivityAttachments(attachmentState) : []),
  ];

  const errorsByStep: Record<number, ValidationError[]> = {};
  for (const err of allErrors) {
    (errorsByStep[err.step] ??= []).push(err);
  }

  const stepsWithErrors = Object.keys(errorsByStep)
    .map(Number)
    .sort((a, b) => a - b);

  const firstInvalidStep = stepsWithErrors.length > 0 ? stepsWithErrors[0] : null;
  const firstInvalidField = firstInvalidStep !== null
    ? (errorsByStep[firstInvalidStep][0]?.field ?? null)
    : null;

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    errorsByStep,
    firstInvalidStep,
    firstInvalidField,
  };
}
