import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  date,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  username: text("username"),
  passwordHash: text("password_hash"),
  role: text("role").notNull(),
  roleLabel: text("role_label").notNull(),
  scope: text("scope").notNull(),
  stateId: integer("state_id"),
  sector: text("sector"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  jobTitle: text("job_title"),
  timezone: text("timezone").notNull().default("Africa/Khartoum"),
  notificationPreferences: jsonb("notification_preferences"),
  status: text("status").notNull().default("active"), // active | invited | suspended | inactive | deactivated
  languagePreference: text("language_preference").notNull().default("en"), // en | ar
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  invitedById: integer("invited_by_id"),
  // pending | sent | failed — tracks whether the invite email was delivered
  inviteEmailStatus: text("invite_email_status").notNull().default("pending"),
  inviteAcceptedAt: timestamp("invite_accepted_at", { withTimezone: true }),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const statesTable = pgTable("states", {
  id: serial("id").primaryKey(),
  // Canonical master-data identity. IDs never change and historical references
  // remain resolvable when operational eligibility changes.
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull().default(""),
  code: text("code").notNull(),
  operationalStatus: text("operational_status").notNull().default("active"),
  officeStatus: text("office_status").notNull().default("unknown"),
  // Read-only from State Administration; assignment stays owned by User Management.
  managerUserId: integer("manager_user_id"),
  officeAddress: text("office_address"),
});

export const localitiesTable = pgTable("localities", {
  id: serial("id").primaryKey(),
  stateId: integer("state_id").notNull(),
  name: text("name").notNull(),
});

export const donorsTable = pgTable("donors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  country: text("country"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  objective: text("objective"),
  status: text("status").notNull().default("draft"),
  sector: text("sector"),
  sectors: jsonb("sectors").$type<string[]>().default([]),
  subSectors: jsonb("sub_sectors").$type<string[]>().default([]),
  assistanceModality: text("assistance_modality"),
  migrationReviewNotes: text("migration_review_notes"),
  classification: text("classification"),
  donor: text("donor").notNull(),
  donorId: integer("donor_id"),
  agreementRef: text("agreement_ref"),
  agreementNumber: text("agreement_number"),
  agreementStart: date("agreement_start"),
  agreementEnd: date("agreement_end"),
  signedDate: date("signed_date"),
  internalNotes: text("internal_notes"),
  description: text("description"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  budgetTotal: numeric("budget_total", { precision: 14, scale: 2 }).notNull().default("0"),
  directCost: numeric("direct_cost", { precision: 14, scale: 2 }).default("0"),
  indirectCost: numeric("indirect_cost", { precision: 14, scale: 2 }).default("0"),
  cafaContribution: numeric("cafa_contribution", { precision: 14, scale: 2 }).default("0"),
  budgetVersion: text("budget_version"),
  currency: text("currency").notNull().default("USD"),
  beneficiariesTarget: integer("beneficiaries_target").notNull().default(0),
  beneficiariesMale: integer("beneficiaries_male").notNull().default(0),
  beneficiariesFemale: integer("beneficiaries_female").notNull().default(0),
  beneficiariesBoys: integer("beneficiaries_boys").notNull().default(0),
  beneficiariesGirls: integer("beneficiaries_girls").notNull().default(0),
  activityTarget: integer("activity_target").notNull().default(0),
  indicatorTarget: integer("indicator_target").notNull().default(0),
  managementLevel: text("management_level").notNull().default("hq_managed"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  reportingFrequency: text("reporting_frequency"),
  hasHqOperations: boolean("has_hq_operations").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by"),
  deletionReason: text("deletion_reason"),
  deletionMode: text("deletion_mode"),
});

export const projectStatesTable = pgTable("project_states", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stateId: integer("state_id").notNull(),
});

export const projectStateAllocationsTable = pgTable("project_state_allocations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stateId: integer("state_id").notNull(),
  budgetAllocation: numeric("budget_allocation", { precision: 14, scale: 2 }).notNull().default("0"),
  beneficiaryTarget: integer("beneficiary_target").notNull().default(0),
  beneficiaryMale: integer("beneficiary_male").notNull().default(0),
  beneficiaryFemale: integer("beneficiary_female").notNull().default(0),
  beneficiaryBoys: integer("beneficiary_boys").notNull().default(0),
  beneficiaryGirls: integer("beneficiary_girls").notNull().default(0),
  activityTarget: integer("activity_target").notNull().default(0),
  indicatorTarget: integer("indicator_target").notNull().default(0),
  stateLead: text("state_lead"),
  stateTeam: jsonb("state_team").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectLocalitiesTable = pgTable("project_localities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  localityId: integer("locality_id").notNull(),
});

export const projectFreeLocalitiesTable = pgTable("project_free_localities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

export const projectAssignmentsTable = pgTable("project_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id"),
  name: text("name"),
  role: text("role").notNull(),
});

export const projectDocumentsTable = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  category: text("category").notNull().default("optional"), // agreement | budget | optional
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull().default(0),
  objectPath: text("object_path").notNull(),
  uploadedById: integer("uploaded_by_id"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
});

export const outputsTable = pgTable("outputs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  translationStatus: text("translation_status").notNull().default("review_required"),
  sourceChecksum: text("source_checksum"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: integer("reviewed_by_id"),
  target: numeric("target", { precision: 14, scale: 2 }).default("0"),
});

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  // Nullable to support standalone activities (no parent project).
  // Standalone: project_id IS NULL, sector and currency are authoritative.
  projectId: integer("project_id"),
  // outputId is also nullable for standalone activities that have no output parent.
  outputId: integer("output_id"),
  indicatorId: integer("indicator_id"),
  stateId: integer("state_id"),
  localityId: integer("locality_id"),
  localityName: text("locality_name"),
  responsibleUserId: integer("responsible_user_id"),
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  target: numeric("target", { precision: 14, scale: 2 }).default("0"),
  status: text("status").notNull().default("planned"),
  progressPct: integer("progress_pct").notNull().default(0),
  plannedStart: date("planned_start"),
  plannedEnd: date("planned_end"),
  budgetPlanned: numeric("budget_planned", { precision: 14, scale: 2 }).default("0"),
  budgetSpent: numeric("budget_spent", { precision: 14, scale: 2 }).notNull().default("0"),
  // Authoritative sector and currency for standalone activities.
  // Ignored for project-linked activities (derived from parent project at query time).
  sector: text("sector"),
  currency: text("currency"),
});

export const indicatorsTable = pgTable("indicators", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  outputId: integer("output_id"),
  code: text("code").notNull(),
  title: text("title").notNull(),
  unit: text("unit").notNull(),
  target: numeric("target", { precision: 14, scale: 2 }).notNull(),
  achieved: numeric("achieved", { precision: 14, scale: 2 }).notNull().default("0"),
  sector: text("sector"),
  subSectors: jsonb("sub_sectors").$type<string[]>().default([]),
});

export const beneficiariesTable = pgTable("beneficiaries", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  gender: text("gender").notNull(),
  ageGroup: text("age_group").notNull(),
  category: text("category").notNull(),
  vulnerability: text("vulnerability"),
  stateId: integer("state_id").notNull(),
  localityId: integer("locality_id"),
  projectId: integer("project_id"),
  assistanceReceived: text("assistance_received"),
  dateOfAssistance: date("date_of_assistance").notNull().defaultNow(),
  verificationStatus: text("verification_status").notNull().default("pending"),
});

export const risksTable = pgTable("risks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  likelihood: text("likelihood").notNull(),
  status: text("status").notNull().default("open"),
  // Nullable since migration 013 (HQ risks have no state).
  stateId: integer("state_id"),
  // "state" | "hq" | null (legacy rows) — added by migration 013.
  locationType: text("location_type"),
  projectId: integer("project_id"),
  planId: integer("plan_id"),
  planActivityId: integer("plan_activity_id"),
  assignedToId: integer("assigned_to_id"),
  impact: text("impact"),
  mitigationPlan: text("mitigation_plan"),
  dueDate: date("due_date"),
  followUpDate: date("follow_up_date"),
  identifiedAt: timestamp("identified_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // locked_by / locked_at are LIVE columns used by the realtime record-lock
  // routes (routes/realtime.ts) — do not remove. The former `version` column
  // was dead optimistic-locking schema and was dropped by migration 028.
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
});

// Planning module ------------------------------------------------------------
// Plans are operational plans that can be either independent or linked to a
// project. Activities live in their own table so we can join risks/budgets and
// track per-activity progress. Objectives are persisted as JSONB on the plan
// (small structured array, no cross-row queries needed).
export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  // monthly | quarterly | annual | action | operational | emergency | custom
  // Nullable: plans may be saved as drafts without a type selected yet.
  planType: text("plan_type"),
  // weekly | monthly | quarterly | annual | on_demand (optional)
  frequency: text("frequency").notNull().default("monthly"),
  projectId: integer("project_id"),
  stateId: integer("state_id").notNull(),
  localityId: integer("locality_id"),
  // free-text localities array — users type locality names not in system
  localities: jsonb("localities").$type<string[]>().default([]),
  sector: text("sector"),
  // multi-sector array — replaces the single sector field for new plans
  sectors: jsonb("sectors").$type<string[]>().default([]),
  // free-text responsible person (replaces the required FK to users)
  responsibleName: text("responsible_name"),
  // Temporary: set by migration when a plan had a legacy sector value that could
  // not be deterministically resolved (e.g. Multi-Sector with ambiguous links).
  migrationReviewNotes: text("migration_review_notes"),
  responsibleUserId: integer("responsible_user_id"),
  // Nullable: plans may be saved as drafts without dates selected yet.
  startDate: date("start_date"),
  endDate: date("end_date"),
  // workflow + operational status share one column:
  // draft | submitted | technically_approved | coordination_approved | approved
  // | active | in_progress | delayed | completed | cancelled | archived
  status: text("status").notNull().default("draft"),
  description: text("description"),
  objectives: jsonb("objectives").$type<Array<{
    title: string;
    description?: string;
    priority?: string;
    expectedOutcome?: string;
  }>>().notNull().default([]),
  budgetPlanned: numeric("budget_planned", { precision: 14, scale: 2 }).notNull().default("0"),
  budgetActual: numeric("budget_actual", { precision: 14, scale: 2 }).notNull().default("0"),
  fundingSource: text("funding_source"),
  currency: text("currency").notNull().default("USD"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  // The most recent explicit final approval. Retained through reopen so
  // editability can require a reopen event after this exact boundary.
  lastFinalApprovedAt: timestamp("last_final_approved_at", { withTimezone: true }),
  // Historical 0/USD values identified by the bounded migration predicate are
  // distinguishable from a deliberately entered zero budget.
  budgetLegacyUnverified: boolean("budget_legacy_unverified").notNull().default(false),
});

export const planActivitiesTable = pgTable("plan_activities", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  objectiveIndex: integer("objective_index"), // index into plans.objectives
  responsibleUserId: integer("responsible_user_id"),
  responsibleName: text("responsible_name"),   // free-text person name
  localityName: text("locality_name"),          // chosen from plan's localities list
  stateId: integer("state_id"),                 // state where activity takes place
  stateName: text("state_name"),                // denormalised for display
  plannedDate: date("planned_date"),            // single activity date (required in UI)
  targetBeneficiaries: integer("target_beneficiaries").notNull().default(0),
  priority: text("priority").notNull().default("medium"), // high | medium | low
  expectedResult: text("expected_result"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  // planned | in_progress | completed | delayed | cancelled
  status: text("status").notNull().default("planned"),
  progressPct: integer("progress_pct").notNull().default(0),
  budgetPlanned: numeric("budget_planned", { precision: 14, scale: 2 }).notNull().default("0"),
  budgetActual: numeric("budget_actual", { precision: 14, scale: 2 }).notNull().default("0"),
  riskId: integer("risk_id"),
  mitigationAction: text("mitigation_action"),
  expectedOutput: text("expected_output"),
  performanceIndicator: text("performance_indicator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planAttachmentsTable = pgTable("plan_attachments", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull().default(0),
  objectPath: text("object_path").notNull(),
  uploadedById: integer("uploaded_by_id"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
});

// Canonical provider-neutral attachments --------------------------------------
// Parent identity is deliberately polymorphic (plan | risk); route-level
// authorisation resolves the canonical parent on every operation.
export const attachmentsTable = pgTable("attachments", {
  id: serial("id").primaryKey(),
  parentType: text("parent_type").notNull(), // plan | risk
  parentId: integer("parent_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  provider: text("provider").notNull(),
  uploadOperationId: text("upload_operation_id").notNull().unique(),
  uploadedById: integer("uploaded_by_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  status: text("status").notNull().default("active"), // active | archived | deleted
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachmentUploadOperationsTable = pgTable("attachment_upload_operations", {
  operationId: text("operation_id").primaryKey(),
  parentType: text("parent_type").notNull(), // plan | risk
  parentId: integer("parent_id").notNull(),
  replacementAttachmentId: integer("replacement_attachment_id"),
  userId: integer("user_id").notNull(),
  objectPath: text("object_path").notNull().unique(),
  // Written before promotion so parent deletion can clean either identity.
  finalObjectPath: text("final_object_path"),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  declaredSize: integer("declared_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"), // pending | finalised | failed
  attachmentId: integer("attachment_id"),
  // Expiry cleanup is deliberately separate from the upload lifecycle. A
  // failed provider delete must remain observable and retryable without making
  // a finalised attachment look pending again.
  cleanupStatus: text("cleanup_status").notNull().default("not_started"), // not_started | pending | failed | completed
  cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
  cleanupError: text("cleanup_error"),
  cleanupCompletedAt: timestamp("cleanup_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalisedAt: timestamp("finalised_at", { withTimezone: true }),
});

// Provider cleanup survives parent deletion. It deliberately has no foreign key
// to an upload operation because parent lifecycle code can remove that source
// row after the cleanup job has been committed.
export const attachmentUploadCleanupJobsTable = pgTable("attachment_upload_cleanup_jobs", {
  operationId: text("operation_id").primaryKey(),
  objectPath: text("object_path").notNull(),
  finalObjectPath: text("final_object_path"),
  status: text("status").notNull().default("pending"), // pending | in_progress | failed | completed
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  // report_type: one of project | activity | program_state | hq_sector
  // DEFAULT removed — new reports must supply an explicit canonical type.
  // NULL is used for unresolved legacy rows pending manual review.
  reportType: text("report_type"),
  activityId: integer("activity_id"),
  reportingMonth: integer("reporting_month"),
  reportingYear: integer("reporting_year"),
  periodStart: timestamp("period_start", { withTimezone: true, mode: "string" }),
  periodEnd: timestamp("period_end", { withTimezone: true, mode: "string" }),
  sector: text("sector"),
  submittedTo: text("submitted_to"),
  status: text("status").notNull().default("draft"),
  projectId: integer("project_id"),
  stateId: integer("state_id"),
  period: text("period").notNull(),
  narrative: text("narrative"),
  executiveSummary: text("executive_summary"),
  challenges: text("challenges"),
  recommendations: text("recommendations"),
  sections: jsonb("sections").$type<Record<string, string>>(),
  beneficiariesMale: integer("beneficiaries_male").default(0),
  beneficiariesFemale: integer("beneficiaries_female").default(0),
  beneficiariesBoys: integer("beneficiaries_boys").default(0),
  beneficiariesGirls: integer("beneficiaries_girls").default(0),
  plannedBudget: numeric("planned_budget", { precision: 14, scale: 2 }),
  actualExpenditure: numeric("actual_expenditure", { precision: 14, scale: 2 }),
  activities: jsonb("activities").$type<Array<Record<string, unknown>>>(),
  quarter: integer("quarter"),
  onDemandReason: text("on_demand_reason"),
  indicatorProgress: jsonb("indicator_progress").$type<Array<Record<string, unknown>>>(),
  submittedById: integer("submitted_by_id").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  // Set by migration 005 for rows that could not be deterministically reclassified.
  migrationReviewNotes: text("migration_review_notes"),
});

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  actorId: integer("actor_id").notNull(),
  comment: text("comment"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  // Global Full Operational Access override audit trail (Migration 020).
  // used_override = true when PM/super_admin acted via override (e.g. self-review).
  // override_reason is required whenever used_override is true.
  usedOverride: boolean("used_override").notNull().default(false),
  overrideReason: text("override_reason"),
});

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  parentId: integer("parent_id"),
  section: text("section"),
  commentType: text("comment_type").notNull().default("general"),
  authorId: integer("author_id").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: integer("resolved_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  message: text("message").notNull(),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One immutable, source-derived event claim per recipient. Kept separate from
 * notifications because email-only delivery intentionally does not create an
 * in-app notification row.
 */
export const notificationEventDedupesTable = pgTable("notification_event_dedupes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  module: text("module").notNull(),
  entityId: integer("entity_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  // Global Full Operational Access override audit trail (Migration 020).
  usedOverride: boolean("used_override").notNull().default(false),
  overrideReason: text("override_reason"),
});

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("direct"),
  name: text("name"),
  projectId: integer("project_id"),
  stateId: integer("state_id"),
  sector: text("sector"),
  description: text("description"),
  createdById: integer("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembersTable = pgTable("conversation_members", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  userId: integer("user_id").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  isAdmin: boolean("is_admin").notNull().default(false),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  body: text("body").notNull(),
  attachments: jsonb("attachments"),
  replyToId: integer("reply_to_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by"),
  deletionType: text("deletion_type"),
  isPinned: boolean("is_pinned").notNull().default(false),
  pinnedBy: integer("pinned_by"),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  forwardedFromId: integer("forwarded_from_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Private message visibility is intentionally separate from the shared message
 * lifecycle. A hide only affects the requesting member; a shared deletion
 * remains represented on messages.deletedAt/deletionType.
 */
export const messageUserHidesTable = pgTable("message_user_hides", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("message_user_hides_message_user_unique").on(table.messageId, table.userId),
]);

/**
 * New Direct conversations claim an immutable unordered pair key. Historical
 * conversations remain untouched and are reconciled separately.
 */
export const directConversationKeysTable = pgTable("direct_conversation_keys", {
  userLowId: integer("user_low_id").notNull(),
  userHighId: integer("user_high_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("direct_conversation_keys_pair_unique").on(table.userLowId, table.userHighId),
  uniqueIndex("direct_conversation_keys_conversation_unique").on(table.conversationId),
]);

/**
 * Project, State and Sector rooms use a canonical identity only for new or
 * explicitly claimed organisational conversations. Ordinary groups are not
 * represented here and remain non-singleton.
 */
export const organisationalConversationKeysTable = pgTable("organisational_conversation_keys", {
  entityKey: text("entity_key").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("organisational_conversation_keys_conversation_unique").on(table.conversationId),
]);

export const messageMentionsTable = pgTable("message_mentions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  mentionedUserId: integer("mentioned_user_id").notNull(),
  mentionedBy: integer("mentioned_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageReactionsTable = pgTable("message_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const manualChaptersTable = pgTable("manual_chapters", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  icon: text("icon").notNull().default("FileText"),
  order: integer("order").notNull().default(0),
  language: text("language").notNull().default("en"),
  status: text("status").notNull().default("published"),
  createdById: integer("created_by_id"),
  updatedById: integer("updated_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const manualSectionsTable = pgTable("manual_sections", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  translationStatus: text("translation_status").notNull().default("review_required"),
  sourceChecksum: text("source_checksum"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: integer("reviewed_by_id"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const manualSopsTable = pgTable("manual_sops", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull(),
  processName: text("process_name").notNull(),
  purpose: text("purpose"),
  responsibleRole: text("responsible_role"),
  steps: jsonb("steps"),
  requiredInputs: text("required_inputs"),
  approvalFlow: text("approval_flow"),
  outputs: text("outputs"),
  timeline: text("timeline"),
  relatedModule: text("related_module"),
  notifications: text("notifications"),
  translationStatus: text("translation_status").notNull().default("review_required"),
  sourceChecksum: text("source_checksum"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: integer("reviewed_by_id"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const manualVersionHistoryTable = pgTable("manual_version_history", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull(),
  sectionId: integer("section_id"),
  previousContent: text("previous_content"),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Localised Manual content is stored separately from the canonical English
 * records.  The base tables retain their stable IDs, slugs, permissions, and
 * editorial history while each supported locale can be reviewed independently.
 */
export const manualChapterLocalizationsTable = pgTable("manual_chapter_localizations", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull(),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chapterLocaleUnique: uniqueIndex("manual_chapter_localizations_chapter_locale_unique")
    .on(table.chapterId, table.locale),
}));

export const manualSectionLocalizationsTable = pgTable("manual_section_localizations", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull(),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sectionLocaleUnique: uniqueIndex("manual_section_localizations_section_locale_unique")
    .on(table.sectionId, table.locale),
}));

export const manualSopLocalizationsTable = pgTable("manual_sop_localizations", {
  id: serial("id").primaryKey(),
  sopId: integer("sop_id").notNull(),
  locale: text("locale").notNull(),
  processName: text("process_name").notNull(),
  purpose: text("purpose"),
  responsibleRole: text("responsible_role"),
  steps: jsonb("steps"),
  requiredInputs: text("required_inputs"),
  approvalFlow: text("approval_flow"),
  outputs: text("outputs"),
  timeline: text("timeline"),
  relatedModule: text("related_module"),
  notifications: text("notifications"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sopLocaleUnique: uniqueIndex("manual_sop_localizations_sop_locale_unique")
    .on(table.sopId, table.locale),
}));

export const manualFaqLocalizationsTable = pgTable("manual_faq_localizations", {
  id: serial("id").primaryKey(),
  faqId: integer("faq_id").notNull(),
  locale: text("locale").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").notNull(),
  translationStatus: text("translation_status").notNull().default("review_required"),
  sourceChecksum: text("source_checksum"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: integer("reviewed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  faqLocaleUnique: uniqueIndex("manual_faq_localizations_faq_locale_unique")
    .on(table.faqId, table.locale),
}));

// Drive files ---------------------------------------------------------------
export const driveFilesTable = pgTable("drive_files", {
  id: serial("id").primaryKey(),
  driveFileId: text("drive_file_id").notNull(),
  driveLink: text("drive_link").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size"),
  module: text("module").notNull(),   // projects | reports | plans | risks | …
  recordId: integer("record_id"),
  projectId: integer("project_id"),
  uploadedByUserId: integer("uploaded_by_user_id").notNull(),
  userRole: text("user_role"),
  stateId: integer("state_id"),
  sector: text("sector"),
  visibilityLevel: text("visibility_level").notNull().default("internal"),
  permissionLevel: text("permission_level").notNull().default("view"),
  versionNumber: integer("version_number").notNull().default(1),
  parentFileId: integer("parent_file_id"),  // previous version
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
  status: text("status").notNull().default("active"), // active | archived | deleted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// AI Assistant chat messages -----------------------------------------------
export const aiChatMessagesTable = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  module: text("module"), // current page context
  userRole: text("user_role"),  // role of the user who sent the message
  status: text("status"),       // success | failed
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// AI Assistant settings (singleton row) ------------------------------------
export const aiSettingsTable = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  enabled: text("enabled").notNull().default("true"),
  systemPromptExtra: text("system_prompt_extra"),
  allowedModules: text("allowed_modules"),
  responseLanguage: text("response_language").notNull().default("auto"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

// Password reset tokens ----------------------------------------------------
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // active | used | expired | revoked
  status: text("status").notNull().default("active"),
  // forgot_password | admin_reset
  source: text("source").notNull().default("forgot_password"),
  // pending | sent | failed — tracks whether the reset email was delivered
  emailStatus: text("email_status").notNull().default("pending"),
  handledById: integer("handled_by_id"),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Email verification tokens -------------------------------------------------
export const emailVerificationTokensTable = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
});

// Training videos ------------------------------------------------------------
export const trainingVideosTable = pgTable("training_videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  moduleName: text("module_name").notNull(),
  roleAccess: text("role_access").notNull().default("all"),
  language: text("language").notNull().default("ar"),
  description: text("description"),
  filePath: text("file_path"),
  duration: integer("duration"),
  status: text("status").notNull().default("draft"),
  generatedBy: integer("generated_by"),
  errorMessage: text("error_message"),
  progressPct: integer("progress_pct").default(0),
  progressLabel: text("progress_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Training completions — per-user per-video progress tracking ---------------
export const trainingCompletionsTable = pgTable("training_completions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  trainingVideoId: integer("training_video_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  watchPercent: integer("watch_percent").notNull().default(0),
  completionStatus: text("completion_status").notNull().default("not_started"),
  totalWatchSeconds: integer("total_watch_seconds").notNull().default(0),
  lastPositionSeconds: integer("last_position_seconds").notNull().default(0),
  certificateIssued: boolean("certificate_issued").notNull().default(false),
});

// Training certificates -------------------------------------------------------
export const trainingCertificatesTable = pgTable("training_certificates", {
  id: serial("id").primaryKey(),
  certificateId: text("certificate_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  trainingVideoId: integer("training_video_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedById: integer("revoked_by_id"),
  reissuedAt: timestamp("reissued_at", { withTimezone: true }),
  reissuedById: integer("reissued_by_id"),
  isActive: boolean("is_active").notNull().default(true),
});

// Voice notes ----------------------------------------------------------------
export const voiceNotesTable = pgTable("voice_notes", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // project | plan | report | risk | comment
  entityId: integer("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull().default("audio/webm"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  recordedById: integer("recorded_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
});

// Idempotency log — survives server restarts, prevents duplicate sync replays ----
export const idempotencyLogTable = pgTable("idempotency_log", {
  id: serial("id").primaryKey(),
  /** UUID sent by the client in x-client-id header. */
  clientId: text("client_id").notNull().unique(),
  /** e.g. "POST /api/reports" — for observability only. */
  operation: text("operation").notNull(),
  /** Null while the atomically claimed operation is in progress. */
  statusCode: integer("status_code"),
  /** JSON-serialised response body to replay on duplicate. */
  responseBody: text("response_body"),
  /** Authenticated actor that owns the client operation ID. */
  actorId: integer("actor_id"),
  /** SHA-256 of method, path and canonical request body. */
  requestHash: text("request_hash"),
  /** in_progress | completed */
  state: text("state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Program SOPs & Resources --------------------------------------------------
export const programResourcesTable = pgTable("program_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // SOPs | Policies | Templates | Guidelines | Manuals | Technical Resources
  category: text("category").notNull(),
  // General / Cross-Cutting | Health | Nutrition | WASH | Education | Protection | Food Security & Livelihoods | Shelter & NFI
  sector: text("sector").notNull(),
  // Set by migration when a legacy sector value could not be deterministically resolved.
  migrationReviewNotes: text("migration_review_notes"),
  description: text("description"),
  versionNumber: text("version_number"),
  effectiveDate: date("effective_date"),
  tags: text("tags"),
  // File storage — object path from presigned-URL upload
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  fileSize: integer("file_size"),
  objectPath: text("object_path").notNull(),
  // active | archived
  status: text("status").notNull().default("active"),
  availabilityStatus: text("availability_status").notNull().default("available"),
  unavailableReason: text("unavailable_reason"),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registry-only metadata.  The parent attachment tables remain the source of
 * truth for bytes, lifecycle, download and deletion.  A registry entry is a
 * one-to-one index record that adds filing metadata without duplicating files.
 */
export const documentRegistryEntriesTable = pgTable("document_registry_entries", {
  id: serial("id").primaryKey(),
  sourceKind: text("source_kind").notNull(), // resource | project_document | drive_file | report_attachment
  sourceId: integer("source_id").notNull(),
  title: text("title"),
  description: text("description"),
  classification: text("classification").notNull(),
  confidentiality: text("confidentiality").notNull().default("internal"),
  retentionYears: integer("retention_years"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  relatedRecordType: text("related_record_type"),
  relatedRecordId: integer("related_record_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("document_registry_entries_source_unique").on(table.sourceKind, table.sourceId),
]);

// Email delivery logs -------------------------------------------------------
export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  emailTo: text("email_to").notNull(),
  emailType: text("email_type").notNull(),
  subject: text("subject"),
  // pending | sent | failed
  status: text("status").notNull().default("pending"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  providerName: text("provider_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
