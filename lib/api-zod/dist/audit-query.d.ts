import { z } from "zod";
export declare const AUDIT_ACTION_CATEGORIES: readonly ["created", "updated", "deleted", "approved"];
export type AuditActionCategory = (typeof AUDIT_ACTION_CATEGORIES)[number];
/**
 * One category definition powers URL aliases, server-side row classification,
 * aggregate counts, and the action predicate used by the Audit Log.
 */
export declare const AUDIT_ACTION_CATEGORY_RULES: Record<AuditActionCategory, {
    aliases: readonly string[];
    sqlPattern: string;
}>;
export declare function normalizeAuditActionCategory(value: string | null | undefined): AuditActionCategory | undefined;
export declare function categorizeAuditAction(action: string): AuditActionCategory | null;
/** Builds a trusted SQL CASE expression from the category rules above. */
export declare function auditActionCategorySql(actionColumn: string): string;
/**
 * Strict transport validator for the Audit Log query.
 *
 * The generated schema supplies the OpenAPI types, enums, bounds and patterns.
 * These cross-field/calendar refinements are deliberately kept here because
 * OpenAPI parameter schemas cannot represent them declaratively.
 */
export declare const AuditLogQueryParams: z.ZodEffects<z.ZodObject<{
    search: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodEnum<["created", "updated", "deleted", "approved", "create", "update", "delete", "approve"]>>;
    module: z.ZodOptional<z.ZodEnum<["ai", "attachments", "auth", "beneficiaries", "comments", "conversation", "drive", "files", "manual", "manual_chapter", "manual_section", "manual_sop", "messages", "notifications", "password_reset", "plans", "profile", "program_resources", "project", "projects", "reports", "risks", "states", "training_videos", "users"]>>;
    entityType: z.ZodOptional<z.ZodEnum<["ai", "attachments", "auth", "beneficiaries", "comments", "conversation", "drive", "files", "manual", "manual_chapter", "manual_section", "manual_sop", "messages", "notifications", "password_reset", "plans", "profile", "program_resources", "project", "projects", "reports", "risks", "states", "training_videos", "users"]>>;
    dateFrom: z.ZodOptional<z.ZodString>;
    dateTo: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    pageSize: number;
    module?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    entityType?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    search?: string | undefined;
    action?: "create" | "approved" | "deleted" | "created" | "updated" | "update" | "delete" | "approve" | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
}, {
    module?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    entityType?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    search?: string | undefined;
    action?: "create" | "approved" | "deleted" | "created" | "updated" | "update" | "delete" | "approve" | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
}>, {
    page: number;
    pageSize: number;
    module?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    entityType?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    search?: string | undefined;
    action?: "create" | "approved" | "deleted" | "created" | "updated" | "update" | "delete" | "approve" | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
}, {
    module?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    entityType?: "comments" | "project" | "conversation" | "projects" | "risks" | "reports" | "states" | "beneficiaries" | "drive" | "messages" | "attachments" | "ai" | "auth" | "files" | "manual" | "manual_chapter" | "manual_section" | "manual_sop" | "notifications" | "password_reset" | "plans" | "profile" | "program_resources" | "training_videos" | "users" | undefined;
    search?: string | undefined;
    action?: "create" | "approved" | "deleted" | "created" | "updated" | "update" | "delete" | "approve" | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
}>;
//# sourceMappingURL=audit-query.d.ts.map