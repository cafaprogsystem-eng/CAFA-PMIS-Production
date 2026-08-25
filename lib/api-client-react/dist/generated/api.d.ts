import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { Activity, ActivityEntry, ArchiveFileListResponse, AttachmentLifecycleResult, AttachmentReconciliationActionResult, AttachmentReconciliationDispositionInput, AttachmentReconciliationListResponse, AttachmentReconciliationRecoveryInput, AttachmentReconciliationReport, AttachmentUploadDescriptor, AttachmentUploadDescriptorRequest, AttachmentUploadFinalizationRequest, AuditLogPage, BeneficiariesBreakdown, Beneficiary, BeneficiaryInput, CanonicalAttachment, CanonicalAttachmentList, ChangePassword200, ChangePasswordInput, CheckProjectDuplicateParams, CheckReportDuplicateParams, ConsolidatedProjectReport, Conversation, ConversationInput, ConversationListPage, ConversationMedia, ConversationMemberInput, ConversationSummary, CurrentUser, DashboardAgenda, DashboardNotificationsSummary, DashboardSummary, DeleteUser200, Donor, DonorInput, DonorPortfolioEntry, DuplicateCheckResult, ExportReportsParams, FocusedProjectDonorScan, FollowUpProject, GetAttachmentReconciliationReportParams, GetConsolidatedProjectReportParams, GetConversationsUnreadCount200, GetDashboardPerformanceProjectsParams, GetDashboardSummaryParams, GetLegacyStorageEvidenceInventoryParams, GetPmrReportingCompletenessParams, GetSectorBudgetParams, GetStatePerformanceParams, GetVoiceNoteUrl200, HealthStatus, Indicator, InvitationListPage, InviteActionResponse, InviteResendInput, LateReport, LegacyStorageEvidenceInventory, ListArchiveFilesParams, ListAttachmentReconciliationEntriesParams, ListAuditLog400, ListAuditLogParams, ListBeneficiariesParams, ListConversationMessagesParams, ListConversationsParams, ListLocalitiesParams, ListNotificationsParams, ListPlansParams, ListProjectsParams, ListReportAuthors200, ListReportAuthorsParams, ListReportsParams, ListRisksParams, ListStatesParams, ListUserInvitationsParams, ListUsersParams, ListVoiceNotesParams, LocalityWithState, LoginInput, Logout200, Message, MessageDeleteInput, MessageEditInput, MessageHistoryPage, MessageInput, NotificationListPage, NotificationMutationResponse, OkResponse, PasswordResetInput, PasswordResetResponse, PendingApprovals, PerformanceScore, PlanDetail, PlanInput, PlanSummary, PlanningDashboard, PmrReportingCompleteness, ProfilePhotoCompleteInput, ProfilePhotoResponse, ProfilePhotoUploadDescriptor, ProfilePhotoUploadRequest, Project, ProjectBudget, ProjectBudgetPerformanceEntry, ProjectDetail, ProjectDocument, ProjectDocumentInput, ProjectDonorCorrection, ProjectDonorCorrectionInput, ProjectInput, ProjectMergeInput, ProjectPerformanceScore, ProjectStateAllocation, ProjectSummary, Reaction, ReactionInput, ReopenPlanBody, Report, ReportAggregates, ReportAttachment, ReportAttachmentInput, ReportDuplicateCheck, ReportInput, ReportPage, ReportStats, ReportsSummary, RetireDevelopmentTestProjectBody, Risk, RiskInput, RiskListResponse, RiskUpdate, SectorBudgetResponse, SectorPerformance, StateConflictError, StateInput, StateLifecycleInput, StateNotFoundError, StatePerformance, StateProfile, StateRecord, StateSnapshot, StateValidationError, SwitcherUser, UpdateProfileInput, UploadUrlRequest, UploadUrlResponse, UpsertProjectStateAllocationsBody, UserCreateResponse, UserDetail, UserDirectoryPage, UserEffectiveAccess, UserInput, UserProfile, UserStatusInput, UserStatusResponse, UserUpdate, UsersSummary, ValidationErrorResponse, VerificationResendResponse, VoiceNote, VoiceNoteInput, WorkflowTransitionInput } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMeUrl: () => string;
/**
 * @summary Get the currently active user (from a signed session cookie; the demo identity header is available only when explicitly enabled outside production)
 */
export declare const getMe: (options?: RequestInit) => Promise<CurrentUser>;
export declare const getGetMeQueryKey: () => readonly ["/api/me"];
export declare const getGetMeQueryOptions: <TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<void>;
/**
 * @summary Get the currently active user (from a signed session cookie; the demo identity header is available only when explicitly enabled outside production)
 */
export declare function useGetMe<TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetProfileUrl: () => string;
/**
 * @summary Get the current user's full profile
 */
export declare const getProfile: (options?: RequestInit) => Promise<UserProfile>;
export declare const getGetProfileQueryKey: () => readonly ["/api/profile"];
export declare const getGetProfileQueryOptions: <TData = Awaited<ReturnType<typeof getProfile>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProfileQueryResult = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
export type GetProfileQueryError = ErrorType<void>;
/**
 * @summary Get the current user's full profile
 */
export declare function useGetProfile<TData = Awaited<ReturnType<typeof getProfile>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateProfileUrl: () => string;
/**
 * @summary Update the current user's editable profile fields
 */
export declare const updateProfile: (updateProfileInput: UpdateProfileInput, options?: RequestInit) => Promise<UserProfile>;
export declare const getUpdateProfileMutationOptions: <TError = ErrorType<void | ValidationErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProfile>>, TError, {
        data: BodyType<UpdateProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateProfile>>, TError, {
    data: BodyType<UpdateProfileInput>;
}, TContext>;
export type UpdateProfileMutationResult = NonNullable<Awaited<ReturnType<typeof updateProfile>>>;
export type UpdateProfileMutationBody = BodyType<UpdateProfileInput>;
export type UpdateProfileMutationError = ErrorType<void | ValidationErrorResponse>;
/**
 * @summary Update the current user's editable profile fields
 */
export declare const useUpdateProfile: <TError = ErrorType<void | ValidationErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProfile>>, TError, {
        data: BodyType<UpdateProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateProfile>>, TError, {
    data: BodyType<UpdateProfileInput>;
}, TContext>;
export declare const getChangePasswordUrl: () => string;
/**
 * @summary Change the current user's password
 */
export declare const changePassword: (changePasswordInput: ChangePasswordInput, options?: RequestInit) => Promise<ChangePassword200>;
export declare const getChangePasswordMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
        data: BodyType<ChangePasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
    data: BodyType<ChangePasswordInput>;
}, TContext>;
export type ChangePasswordMutationResult = NonNullable<Awaited<ReturnType<typeof changePassword>>>;
export type ChangePasswordMutationBody = BodyType<ChangePasswordInput>;
export type ChangePasswordMutationError = ErrorType<void>;
/**
 * @summary Change the current user's password
 */
export declare const useChangePassword: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
        data: BodyType<ChangePasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof changePassword>>, TError, {
    data: BodyType<ChangePasswordInput>;
}, TContext>;
export declare const getRequestProfilePhotoUploadUrlUrl: () => string;
/**
 * @summary Request a short-lived upload URL for the signed-in user's profile photo
 */
export declare const requestProfilePhotoUploadUrl: (profilePhotoUploadRequest: ProfilePhotoUploadRequest, options?: RequestInit) => Promise<ProfilePhotoUploadDescriptor>;
export declare const getRequestProfilePhotoUploadUrlMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestProfilePhotoUploadUrl>>, TError, {
        data: BodyType<ProfilePhotoUploadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestProfilePhotoUploadUrl>>, TError, {
    data: BodyType<ProfilePhotoUploadRequest>;
}, TContext>;
export type RequestProfilePhotoUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestProfilePhotoUploadUrl>>>;
export type RequestProfilePhotoUploadUrlMutationBody = BodyType<ProfilePhotoUploadRequest>;
export type RequestProfilePhotoUploadUrlMutationError = ErrorType<void>;
/**
 * @summary Request a short-lived upload URL for the signed-in user's profile photo
 */
export declare const useRequestProfilePhotoUploadUrl: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestProfilePhotoUploadUrl>>, TError, {
        data: BodyType<ProfilePhotoUploadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestProfilePhotoUploadUrl>>, TError, {
    data: BodyType<ProfilePhotoUploadRequest>;
}, TContext>;
export declare const getGetProfilePhotoUrl: () => string;
/**
 * @summary Stream the signed-in user's current profile photo through an authenticated proxy
 */
export declare const getProfilePhoto: (options?: RequestInit) => Promise<Blob>;
export declare const getGetProfilePhotoQueryKey: () => readonly ["/api/profile/photo"];
export declare const getGetProfilePhotoQueryOptions: <TData = Awaited<ReturnType<typeof getProfilePhoto>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfilePhoto>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProfilePhoto>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProfilePhotoQueryResult = NonNullable<Awaited<ReturnType<typeof getProfilePhoto>>>;
export type GetProfilePhotoQueryError = ErrorType<void>;
/**
 * @summary Stream the signed-in user's current profile photo through an authenticated proxy
 */
export declare function useGetProfilePhoto<TData = Awaited<ReturnType<typeof getProfilePhoto>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfilePhoto>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCompleteProfilePhotoUploadUrl: () => string;
/**
 * @summary Verify and attach an uploaded photo to the signed-in user's profile
 */
export declare const completeProfilePhotoUpload: (profilePhotoCompleteInput: ProfilePhotoCompleteInput, options?: RequestInit) => Promise<ProfilePhotoResponse>;
export declare const getCompleteProfilePhotoUploadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeProfilePhotoUpload>>, TError, {
        data: BodyType<ProfilePhotoCompleteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completeProfilePhotoUpload>>, TError, {
    data: BodyType<ProfilePhotoCompleteInput>;
}, TContext>;
export type CompleteProfilePhotoUploadMutationResult = NonNullable<Awaited<ReturnType<typeof completeProfilePhotoUpload>>>;
export type CompleteProfilePhotoUploadMutationBody = BodyType<ProfilePhotoCompleteInput>;
export type CompleteProfilePhotoUploadMutationError = ErrorType<void>;
/**
 * @summary Verify and attach an uploaded photo to the signed-in user's profile
 */
export declare const useCompleteProfilePhotoUpload: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeProfilePhotoUpload>>, TError, {
        data: BodyType<ProfilePhotoCompleteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completeProfilePhotoUpload>>, TError, {
    data: BodyType<ProfilePhotoCompleteInput>;
}, TContext>;
export declare const getRemoveProfilePhotoUrl: () => string;
/**
 * @summary Remove the signed-in user's profile photo
 */
export declare const removeProfilePhoto: (options?: RequestInit) => Promise<ProfilePhotoResponse>;
export declare const getRemoveProfilePhotoMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeProfilePhoto>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof removeProfilePhoto>>, TError, void, TContext>;
export type RemoveProfilePhotoMutationResult = NonNullable<Awaited<ReturnType<typeof removeProfilePhoto>>>;
export type RemoveProfilePhotoMutationError = ErrorType<unknown>;
/**
 * @summary Remove the signed-in user's profile photo
 */
export declare const useRemoveProfilePhoto: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeProfilePhoto>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof removeProfilePhoto>>, TError, void, TContext>;
export declare const getListNotificationsUrl: (params?: ListNotificationsParams) => string;
/**
 * Returns only the current recipient's rows. Results are ordered newest-first by created timestamp and notification ID. `unread` is the total unread count across the recipient's full inbox, independent of list filters.

 * @summary List the authenticated user's notifications
 */
export declare const listNotifications: (params?: ListNotificationsParams, options?: RequestInit) => Promise<NotificationListPage>;
export declare const getListNotificationsQueryKey: (params?: ListNotificationsParams) => readonly ["/api/notifications", ...ListNotificationsParams[]];
export declare const getListNotificationsQueryOptions: <TData = Awaited<ReturnType<typeof listNotifications>>, TError = ErrorType<void>>(params?: ListNotificationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listNotifications>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listNotifications>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListNotificationsQueryResult = NonNullable<Awaited<ReturnType<typeof listNotifications>>>;
export type ListNotificationsQueryError = ErrorType<void>;
/**
 * @summary List the authenticated user's notifications
 */
export declare function useListNotifications<TData = Awaited<ReturnType<typeof listNotifications>>, TError = ErrorType<void>>(params?: ListNotificationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listNotifications>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getMarkNotificationReadUrl: (notificationId: number) => string;
/**
 * @summary Mark one recipient-owned notification as read
 */
export declare const markNotificationRead: (notificationId: number, options?: RequestInit) => Promise<NotificationMutationResponse>;
export declare const getMarkNotificationReadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markNotificationRead>>, TError, {
        notificationId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof markNotificationRead>>, TError, {
    notificationId: number;
}, TContext>;
export type MarkNotificationReadMutationResult = NonNullable<Awaited<ReturnType<typeof markNotificationRead>>>;
export type MarkNotificationReadMutationError = ErrorType<void>;
/**
 * @summary Mark one recipient-owned notification as read
 */
export declare const useMarkNotificationRead: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markNotificationRead>>, TError, {
        notificationId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof markNotificationRead>>, TError, {
    notificationId: number;
}, TContext>;
export declare const getMarkAllNotificationsReadUrl: () => string;
/**
 * @summary Mark every unread notification belonging to the current recipient as read
 */
export declare const markAllNotificationsRead: (options?: RequestInit) => Promise<NotificationMutationResponse>;
export declare const getMarkAllNotificationsReadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markAllNotificationsRead>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof markAllNotificationsRead>>, TError, void, TContext>;
export type MarkAllNotificationsReadMutationResult = NonNullable<Awaited<ReturnType<typeof markAllNotificationsRead>>>;
export type MarkAllNotificationsReadMutationError = ErrorType<void>;
/**
 * @summary Mark every unread notification belonging to the current recipient as read
 */
export declare const useMarkAllNotificationsRead: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markAllNotificationsRead>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof markAllNotificationsRead>>, TError, void, TContext>;
export declare const getLoginUrl: () => string;
/**
 * @summary Authenticate with username (or email) + password and start a session
 */
export declare const login: (loginInput: LoginInput, options?: RequestInit) => Promise<CurrentUser>;
export declare const getLoginMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginInput>;
export type LoginMutationError = ErrorType<void>;
/**
 * @summary Authenticate with username (or email) + password and start a session
 */
export declare const useLogin: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export declare const getLogoutUrl: () => string;
/**
 * @summary Revoke the active server session and clear its cookie
 */
export declare const logout: (options?: RequestInit) => Promise<Logout200>;
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
/**
 * @summary Revoke the active server session and clear its cookie
 */
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export declare const getListSwitcherUsersUrl: () => string;
/**
 * @summary Development-only active-user list for the explicitly enabled demo role switcher (unavailable in production)
 */
export declare const listSwitcherUsers: (options?: RequestInit) => Promise<SwitcherUser[]>;
export declare const getListSwitcherUsersQueryKey: () => readonly ["/api/users/switcher"];
export declare const getListSwitcherUsersQueryOptions: <TData = Awaited<ReturnType<typeof listSwitcherUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSwitcherUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSwitcherUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSwitcherUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listSwitcherUsers>>>;
export type ListSwitcherUsersQueryError = ErrorType<unknown>;
/**
 * @summary Development-only active-user list for the explicitly enabled demo role switcher (unavailable in production)
 */
export declare function useListSwitcherUsers<TData = Awaited<ReturnType<typeof listSwitcherUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSwitcherUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListUsersUrl: (params?: ListUsersParams) => string;
/**
 * @summary List authorised directory users. Supports bounded server-side search, filters, and pagination.
 */
export declare const listUsers: (params?: ListUsersParams, options?: RequestInit) => Promise<UserDirectoryPage>;
export declare const getListUsersQueryKey: (params?: ListUsersParams) => readonly ["/api/users", ...ListUsersParams[]];
export declare const getListUsersQueryOptions: <TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(params?: ListUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listUsers>>>;
export type ListUsersQueryError = ErrorType<unknown>;
/**
 * @summary List authorised directory users. Supports bounded server-side search, filters, and pagination.
 */
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(params?: ListUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateUserUrl: () => string;
/**
 * @summary Create a new user (super admin only). If status=invited or no password, an invite token is generated.
 */
export declare const createUser: (userInput: UserInput, options?: RequestInit) => Promise<UserCreateResponse>;
export declare const getCreateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
        data: BodyType<UserInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
    data: BodyType<UserInput>;
}, TContext>;
export type CreateUserMutationResult = NonNullable<Awaited<ReturnType<typeof createUser>>>;
export type CreateUserMutationBody = BodyType<UserInput>;
export type CreateUserMutationError = ErrorType<unknown>;
/**
 * @summary Create a new user (super admin only). If status=invited or no password, an invite token is generated.
 */
export declare const useCreateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
        data: BodyType<UserInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createUser>>, TError, {
    data: BodyType<UserInput>;
}, TContext>;
export declare const getGetUsersSummaryUrl: () => string;
/**
 * @summary Aggregate counts for the user-management dashboard cards
 */
export declare const getUsersSummary: (options?: RequestInit) => Promise<UsersSummary>;
export declare const getGetUsersSummaryQueryKey: () => readonly ["/api/users/summary"];
export declare const getGetUsersSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getUsersSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUsersSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUsersSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUsersSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getUsersSummary>>>;
export type GetUsersSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Aggregate counts for the user-management dashboard cards
 */
export declare function useGetUsersSummary<TData = Awaited<ReturnType<typeof getUsersSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUsersSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetUserUrl: (id: number) => string;
export declare const getUser: (id: number, options?: RequestInit) => Promise<UserDetail>;
export declare const getGetUserQueryKey: (id: number) => readonly [`/api/users/${number}`];
export declare const getGetUserQueryOptions: <TData = Awaited<ReturnType<typeof getUser>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserQueryResult = NonNullable<Awaited<ReturnType<typeof getUser>>>;
export type GetUserQueryError = ErrorType<unknown>;
export declare function useGetUser<TData = Awaited<ReturnType<typeof getUser>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateUserUrl: (id: number) => string;
export declare const updateUser: (id: number, userUpdate: UserUpdate, options?: RequestInit) => Promise<UserDetail>;
export declare const getUpdateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UserUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UserUpdate>;
}, TContext>;
export type UpdateUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateUser>>>;
export type UpdateUserMutationBody = BodyType<UserUpdate>;
export type UpdateUserMutationError = ErrorType<unknown>;
export declare const useUpdateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UserUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UserUpdate>;
}, TContext>;
export declare const getDeleteUserUrl: (id: number) => string;
export declare const deleteUser: (id: number, options?: RequestInit) => Promise<DeleteUser200>;
export declare const getDeleteUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
export type DeleteUserMutationResult = NonNullable<Awaited<ReturnType<typeof deleteUser>>>;
export type DeleteUserMutationError = ErrorType<unknown>;
export declare const useDeleteUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
export declare const getChangeUserStatusUrl: (id: number) => string;
export declare const changeUserStatus: (id: number, userStatusInput: UserStatusInput, options?: RequestInit) => Promise<UserStatusResponse>;
export declare const getChangeUserStatusMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeUserStatus>>, TError, {
        id: number;
        data: BodyType<UserStatusInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changeUserStatus>>, TError, {
    id: number;
    data: BodyType<UserStatusInput>;
}, TContext>;
export type ChangeUserStatusMutationResult = NonNullable<Awaited<ReturnType<typeof changeUserStatus>>>;
export type ChangeUserStatusMutationBody = BodyType<UserStatusInput>;
export type ChangeUserStatusMutationError = ErrorType<unknown>;
export declare const useChangeUserStatus: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeUserStatus>>, TError, {
        id: number;
        data: BodyType<UserStatusInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof changeUserStatus>>, TError, {
    id: number;
    data: BodyType<UserStatusInput>;
}, TContext>;
export declare const getResendUserInviteUrl: (id: number) => string;
/**
 * @summary Rotate and send a pending account-setup invitation (super admin only).
 */
export declare const resendUserInvite: (id: number, inviteResendInput?: InviteResendInput, options?: RequestInit) => Promise<InviteActionResponse>;
export declare const getResendUserInviteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resendUserInvite>>, TError, {
        id: number;
        data?: BodyType<InviteResendInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resendUserInvite>>, TError, {
    id: number;
    data?: BodyType<InviteResendInput>;
}, TContext>;
export type ResendUserInviteMutationResult = NonNullable<Awaited<ReturnType<typeof resendUserInvite>>>;
export type ResendUserInviteMutationBody = BodyType<InviteResendInput> | undefined;
export type ResendUserInviteMutationError = ErrorType<unknown>;
/**
 * @summary Rotate and send a pending account-setup invitation (super admin only).
 */
export declare const useResendUserInvite: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resendUserInvite>>, TError, {
        id: number;
        data?: BodyType<InviteResendInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resendUserInvite>>, TError, {
    id: number;
    data?: BodyType<InviteResendInput>;
}, TContext>;
export declare const getCancelUserInviteUrl: (id: number) => string;
/**
 * @summary Cancel an unaccepted invitation and deactivate the account (super admin only).
 */
export declare const cancelUserInvite: (id: number, options?: RequestInit) => Promise<OkResponse>;
export declare const getCancelUserInviteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelUserInvite>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof cancelUserInvite>>, TError, {
    id: number;
}, TContext>;
export type CancelUserInviteMutationResult = NonNullable<Awaited<ReturnType<typeof cancelUserInvite>>>;
export type CancelUserInviteMutationError = ErrorType<unknown>;
/**
 * @summary Cancel an unaccepted invitation and deactivate the account (super admin only).
 */
export declare const useCancelUserInvite: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelUserInvite>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof cancelUserInvite>>, TError, {
    id: number;
}, TContext>;
export declare const getResendUserVerificationUrl: (id: number) => string;
/**
 * @summary Send a fresh email-verification link (super admin only).
 */
export declare const resendUserVerification: (id: number, options?: RequestInit) => Promise<VerificationResendResponse>;
export declare const getResendUserVerificationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resendUserVerification>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resendUserVerification>>, TError, {
    id: number;
}, TContext>;
export type ResendUserVerificationMutationResult = NonNullable<Awaited<ReturnType<typeof resendUserVerification>>>;
export type ResendUserVerificationMutationError = ErrorType<unknown>;
/**
 * @summary Send a fresh email-verification link (super admin only).
 */
export declare const useResendUserVerification: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resendUserVerification>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resendUserVerification>>, TError, {
    id: number;
}, TContext>;
export declare const getListUserInvitationsUrl: (params?: ListUserInvitationsParams) => string;
/**
 * @summary List authorised invitation lifecycle records and full filtered lifecycle totals without account-setup tokens.
 */
export declare const listUserInvitations: (params?: ListUserInvitationsParams, options?: RequestInit) => Promise<InvitationListPage>;
export declare const getListUserInvitationsQueryKey: (params?: ListUserInvitationsParams) => readonly ["/api/users/invitations", ...ListUserInvitationsParams[]];
export declare const getListUserInvitationsQueryOptions: <TData = Awaited<ReturnType<typeof listUserInvitations>>, TError = ErrorType<unknown>>(params?: ListUserInvitationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUserInvitations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listUserInvitations>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListUserInvitationsQueryResult = NonNullable<Awaited<ReturnType<typeof listUserInvitations>>>;
export type ListUserInvitationsQueryError = ErrorType<unknown>;
/**
 * @summary List authorised invitation lifecycle records and full filtered lifecycle totals without account-setup tokens.
 */
export declare function useListUserInvitations<TData = Awaited<ReturnType<typeof listUserInvitations>>, TError = ErrorType<unknown>>(params?: ListUserInvitationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUserInvitations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getResetUserPasswordUrl: (id: number) => string;
/**
 * @summary Reset a user's password directly, or re-issue an invite token.
 */
export declare const resetUserPassword: (id: number, passwordResetInput: PasswordResetInput, options?: RequestInit) => Promise<PasswordResetResponse>;
export declare const getResetUserPasswordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetUserPassword>>, TError, {
        id: number;
        data: BodyType<PasswordResetInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resetUserPassword>>, TError, {
    id: number;
    data: BodyType<PasswordResetInput>;
}, TContext>;
export type ResetUserPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof resetUserPassword>>>;
export type ResetUserPasswordMutationBody = BodyType<PasswordResetInput>;
export type ResetUserPasswordMutationError = ErrorType<unknown>;
/**
 * @summary Reset a user's password directly, or re-issue an invite token.
 */
export declare const useResetUserPassword: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetUserPassword>>, TError, {
        id: number;
        data: BodyType<PasswordResetInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resetUserPassword>>, TError, {
    id: number;
    data: BodyType<PasswordResetInput>;
}, TContext>;
export declare const getGetUserEffectiveAccessUrl: (id: number) => string;
/**
 * @summary Resolve effective permissions and scope for a target user. Requires users.manage. Response never includes passwords, hashes, tokens, or credentials.
 */
export declare const getUserEffectiveAccess: (id: number, options?: RequestInit) => Promise<UserEffectiveAccess>;
export declare const getGetUserEffectiveAccessQueryKey: (id: number) => readonly [`/api/users/${number}/effective-access`];
export declare const getGetUserEffectiveAccessQueryOptions: <TData = Awaited<ReturnType<typeof getUserEffectiveAccess>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserEffectiveAccess>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUserEffectiveAccess>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserEffectiveAccessQueryResult = NonNullable<Awaited<ReturnType<typeof getUserEffectiveAccess>>>;
export type GetUserEffectiveAccessQueryError = ErrorType<void>;
/**
 * @summary Resolve effective permissions and scope for a target user. Requires users.manage. Response never includes passwords, hashes, tokens, or credentials.
 */
export declare function useGetUserEffectiveAccess<TData = Awaited<ReturnType<typeof getUserEffectiveAccess>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserEffectiveAccess>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListStatesUrl: (params?: ListStatesParams) => string;
/**
 * @summary List active operational State options or the administrative registry
 */
export declare const listStates: (params?: ListStatesParams, options?: RequestInit) => Promise<StateRecord[]>;
export declare const getListStatesQueryKey: (params?: ListStatesParams) => readonly ["/api/states", ...ListStatesParams[]];
export declare const getListStatesQueryOptions: <TData = Awaited<ReturnType<typeof listStates>>, TError = ErrorType<void>>(params?: ListStatesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listStates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listStates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListStatesQueryResult = NonNullable<Awaited<ReturnType<typeof listStates>>>;
export type ListStatesQueryError = ErrorType<void>;
/**
 * @summary List active operational State options or the administrative registry
 */
export declare function useListStates<TData = Awaited<ReturnType<typeof listStates>>, TError = ErrorType<void>>(params?: ListStatesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listStates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateStateUrl: () => string;
/**
 * Only State-registry administrators may create States. Manager assignment is read-only and remains owned by User Management.
 * @summary Create a canonical State registry record
 */
export declare const createState: (stateInput: StateInput, options?: RequestInit) => Promise<StateRecord>;
export declare const getCreateStateMutationOptions: <TError = ErrorType<void | StateConflictError | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createState>>, TError, {
        data: BodyType<StateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createState>>, TError, {
    data: BodyType<StateInput>;
}, TContext>;
export type CreateStateMutationResult = NonNullable<Awaited<ReturnType<typeof createState>>>;
export type CreateStateMutationBody = BodyType<StateInput>;
export type CreateStateMutationError = ErrorType<void | StateConflictError | StateValidationError>;
/**
 * @summary Create a canonical State registry record
 */
export declare const useCreateState: <TError = ErrorType<void | StateConflictError | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createState>>, TError, {
        data: BodyType<StateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createState>>, TError, {
    data: BodyType<StateInput>;
}, TContext>;
export declare const getGetStateUrl: (stateId: number) => string;
/**
 * @summary Get State registry detail and read-only references
 */
export declare const getState: (stateId: number, options?: RequestInit) => Promise<StateProfile>;
export declare const getGetStateQueryKey: (stateId: number) => readonly [`/api/states/${number}`];
export declare const getGetStateQueryOptions: <TData = Awaited<ReturnType<typeof getState>>, TError = ErrorType<void>>(stateId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getState>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getState>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStateQueryResult = NonNullable<Awaited<ReturnType<typeof getState>>>;
export type GetStateQueryError = ErrorType<void>;
/**
 * @summary Get State registry detail and read-only references
 */
export declare function useGetState<TData = Awaited<ReturnType<typeof getState>>, TError = ErrorType<void>>(stateId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getState>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateStateUrl: (stateId: number) => string;
/**
 * Only name, code, and office address are editable here. Manager assignment remains read-only and owned by User Management.
 * @summary Edit canonical State fields without changing its ID
 */
export declare const updateState: (stateId: number, stateInput: StateInput, options?: RequestInit) => Promise<StateRecord>;
export declare const getUpdateStateMutationOptions: <TError = ErrorType<void | StateConflictError | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateState>>, TError, {
        stateId: number;
        data: BodyType<StateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateState>>, TError, {
    stateId: number;
    data: BodyType<StateInput>;
}, TContext>;
export type UpdateStateMutationResult = NonNullable<Awaited<ReturnType<typeof updateState>>>;
export type UpdateStateMutationBody = BodyType<StateInput>;
export type UpdateStateMutationError = ErrorType<void | StateConflictError | StateValidationError>;
/**
 * @summary Edit canonical State fields without changing its ID
 */
export declare const useUpdateState: <TError = ErrorType<void | StateConflictError | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateState>>, TError, {
        stateId: number;
        data: BodyType<StateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateState>>, TError, {
    stateId: number;
    data: BodyType<StateInput>;
}, TContext>;
export declare const getUpdateStateLifecycleUrl: (stateId: number) => string;
/**
 * Only State-registry administrators may make a confirmed, audited lifecycle change. No related records are created, reassigned, or deleted.
 * @summary Confirm and update State operational or office status
 */
export declare const updateStateLifecycle: (stateId: number, stateLifecycleInput: StateLifecycleInput, options?: RequestInit) => Promise<StateRecord>;
export declare const getUpdateStateLifecycleMutationOptions: <TError = ErrorType<void | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateStateLifecycle>>, TError, {
        stateId: number;
        data: BodyType<StateLifecycleInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateStateLifecycle>>, TError, {
    stateId: number;
    data: BodyType<StateLifecycleInput>;
}, TContext>;
export type UpdateStateLifecycleMutationResult = NonNullable<Awaited<ReturnType<typeof updateStateLifecycle>>>;
export type UpdateStateLifecycleMutationBody = BodyType<StateLifecycleInput>;
export type UpdateStateLifecycleMutationError = ErrorType<void | StateValidationError>;
/**
 * @summary Confirm and update State operational or office status
 */
export declare const useUpdateStateLifecycle: <TError = ErrorType<void | StateValidationError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateStateLifecycle>>, TError, {
        stateId: number;
        data: BodyType<StateLifecycleInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateStateLifecycle>>, TError, {
    stateId: number;
    data: BodyType<StateLifecycleInput>;
}, TContext>;
export declare const getGetStateSnapshotUrl: (stateId: number) => string;
/**
 * @summary Read State Program Report snapshot data for an existing State
 */
export declare const getStateSnapshot: (stateId: number, options?: RequestInit) => Promise<StateSnapshot>;
export declare const getGetStateSnapshotQueryKey: (stateId: number) => readonly [`/api/states/${number}/snapshot`];
export declare const getGetStateSnapshotQueryOptions: <TData = Awaited<ReturnType<typeof getStateSnapshot>>, TError = ErrorType<void | StateNotFoundError | StateValidationError>>(stateId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStateSnapshot>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStateSnapshot>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStateSnapshotQueryResult = NonNullable<Awaited<ReturnType<typeof getStateSnapshot>>>;
export type GetStateSnapshotQueryError = ErrorType<void | StateNotFoundError | StateValidationError>;
/**
 * @summary Read State Program Report snapshot data for an existing State
 */
export declare function useGetStateSnapshot<TData = Awaited<ReturnType<typeof getStateSnapshot>>, TError = ErrorType<void | StateNotFoundError | StateValidationError>>(stateId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStateSnapshot>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListVoiceNotesUrl: (params: ListVoiceNotesParams) => string;
/**
 * @summary List voice notes for an entity
 */
export declare const listVoiceNotes: (params: ListVoiceNotesParams, options?: RequestInit) => Promise<VoiceNote[]>;
export declare const getListVoiceNotesQueryKey: (params?: ListVoiceNotesParams) => readonly ["/api/voice-notes", ...ListVoiceNotesParams[]];
export declare const getListVoiceNotesQueryOptions: <TData = Awaited<ReturnType<typeof listVoiceNotes>>, TError = ErrorType<unknown>>(params: ListVoiceNotesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVoiceNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listVoiceNotes>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListVoiceNotesQueryResult = NonNullable<Awaited<ReturnType<typeof listVoiceNotes>>>;
export type ListVoiceNotesQueryError = ErrorType<unknown>;
/**
 * @summary List voice notes for an entity
 */
export declare function useListVoiceNotes<TData = Awaited<ReturnType<typeof listVoiceNotes>>, TError = ErrorType<unknown>>(params: ListVoiceNotesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVoiceNotes>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateVoiceNoteUrl: () => string;
/**
 * @summary Save a voice note after upload
 */
export declare const createVoiceNote: (voiceNoteInput: VoiceNoteInput, options?: RequestInit) => Promise<VoiceNote>;
export declare const getCreateVoiceNoteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createVoiceNote>>, TError, {
        data: BodyType<VoiceNoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createVoiceNote>>, TError, {
    data: BodyType<VoiceNoteInput>;
}, TContext>;
export type CreateVoiceNoteMutationResult = NonNullable<Awaited<ReturnType<typeof createVoiceNote>>>;
export type CreateVoiceNoteMutationBody = BodyType<VoiceNoteInput>;
export type CreateVoiceNoteMutationError = ErrorType<unknown>;
/**
 * @summary Save a voice note after upload
 */
export declare const useCreateVoiceNote: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createVoiceNote>>, TError, {
        data: BodyType<VoiceNoteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createVoiceNote>>, TError, {
    data: BodyType<VoiceNoteInput>;
}, TContext>;
export declare const getDeleteVoiceNoteUrl: (id: number) => string;
export declare const deleteVoiceNote: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteVoiceNoteMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteVoiceNote>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteVoiceNote>>, TError, {
    id: number;
}, TContext>;
export type DeleteVoiceNoteMutationResult = NonNullable<Awaited<ReturnType<typeof deleteVoiceNote>>>;
export type DeleteVoiceNoteMutationError = ErrorType<unknown>;
export declare const useDeleteVoiceNote: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteVoiceNote>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteVoiceNote>>, TError, {
    id: number;
}, TContext>;
export declare const getGetVoiceNoteUrlUrl: (id: number) => string;
export declare const getVoiceNoteUrl: (id: number, options?: RequestInit) => Promise<GetVoiceNoteUrl200>;
export declare const getGetVoiceNoteUrlQueryKey: (id: number) => readonly [`/api/voice-notes/${number}/url`];
export declare const getGetVoiceNoteUrlQueryOptions: <TData = Awaited<ReturnType<typeof getVoiceNoteUrl>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getVoiceNoteUrl>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getVoiceNoteUrl>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetVoiceNoteUrlQueryResult = NonNullable<Awaited<ReturnType<typeof getVoiceNoteUrl>>>;
export type GetVoiceNoteUrlQueryError = ErrorType<unknown>;
export declare function useGetVoiceNoteUrl<TData = Awaited<ReturnType<typeof getVoiceNoteUrl>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getVoiceNoteUrl>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListDonorsUrl: () => string;
/**
 * @summary List all donors
 */
export declare const listDonors: (options?: RequestInit) => Promise<Donor[]>;
export declare const getListDonorsQueryKey: () => readonly ["/api/donors"];
export declare const getListDonorsQueryOptions: <TData = Awaited<ReturnType<typeof listDonors>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDonors>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listDonors>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListDonorsQueryResult = NonNullable<Awaited<ReturnType<typeof listDonors>>>;
export type ListDonorsQueryError = ErrorType<unknown>;
/**
 * @summary List all donors
 */
export declare function useListDonors<TData = Awaited<ReturnType<typeof listDonors>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDonors>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateDonorUrl: () => string;
/**
 * @summary Create a new donor
 */
export declare const createDonor: (donorInput: DonorInput, options?: RequestInit) => Promise<Donor>;
export declare const getCreateDonorMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createDonor>>, TError, {
        data: BodyType<DonorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createDonor>>, TError, {
    data: BodyType<DonorInput>;
}, TContext>;
export type CreateDonorMutationResult = NonNullable<Awaited<ReturnType<typeof createDonor>>>;
export type CreateDonorMutationBody = BodyType<DonorInput>;
export type CreateDonorMutationError = ErrorType<unknown>;
/**
 * @summary Create a new donor
 */
export declare const useCreateDonor: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createDonor>>, TError, {
        data: BodyType<DonorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createDonor>>, TError, {
    data: BodyType<DonorInput>;
}, TContext>;
export declare const getListProjectsUrl: (params?: ListProjectsParams) => string;
/**
 * @summary List projects with optional filters
 */
export declare const listProjects: (params?: ListProjectsParams, options?: RequestInit) => Promise<ProjectSummary[]>;
export declare const getListProjectsQueryKey: (params?: ListProjectsParams) => readonly ["/api/projects", ...ListProjectsParams[]];
export declare const getListProjectsQueryOptions: <TData = Awaited<ReturnType<typeof listProjects>>, TError = ErrorType<unknown>>(params?: ListProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjects>>>;
export type ListProjectsQueryError = ErrorType<unknown>;
/**
 * @summary List projects with optional filters
 */
export declare function useListProjects<TData = Awaited<ReturnType<typeof listProjects>>, TError = ErrorType<unknown>>(params?: ListProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateProjectUrl: () => string;
/**
 * @summary Create a new project draft
 */
export declare const createProject: (projectInput: ProjectInput, options?: RequestInit) => Promise<Project>;
export declare const getCreateProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
        data: BodyType<ProjectInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
    data: BodyType<ProjectInput>;
}, TContext>;
export type CreateProjectMutationResult = NonNullable<Awaited<ReturnType<typeof createProject>>>;
export type CreateProjectMutationBody = BodyType<ProjectInput>;
export type CreateProjectMutationError = ErrorType<unknown>;
/**
 * @summary Create a new project draft
 */
export declare const useCreateProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
        data: BodyType<ProjectInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createProject>>, TError, {
    data: BodyType<ProjectInput>;
}, TContext>;
export declare const getCheckProjectDuplicateUrl: (params?: CheckProjectDuplicateParams) => string;
/**
 * @summary Check if a project with the same agreement number / donor / title already exists
 */
export declare const checkProjectDuplicate: (params?: CheckProjectDuplicateParams, options?: RequestInit) => Promise<DuplicateCheckResult>;
export declare const getCheckProjectDuplicateQueryKey: (params?: CheckProjectDuplicateParams) => readonly ["/api/projects/duplicate-check", ...CheckProjectDuplicateParams[]];
export declare const getCheckProjectDuplicateQueryOptions: <TData = Awaited<ReturnType<typeof checkProjectDuplicate>>, TError = ErrorType<unknown>>(params?: CheckProjectDuplicateParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof checkProjectDuplicate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof checkProjectDuplicate>>, TError, TData> & {
    queryKey: QueryKey;
};
export type CheckProjectDuplicateQueryResult = NonNullable<Awaited<ReturnType<typeof checkProjectDuplicate>>>;
export type CheckProjectDuplicateQueryError = ErrorType<unknown>;
/**
 * @summary Check if a project with the same agreement number / donor / title already exists
 */
export declare function useCheckProjectDuplicate<TData = Awaited<ReturnType<typeof checkProjectDuplicate>>, TError = ErrorType<unknown>>(params?: CheckProjectDuplicateParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof checkProjectDuplicate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getMergeProjectDataUrl: (projectId: number) => string;
/**
 * @summary Append states / sectors / localities to an existing project without duplication
 */
export declare const mergeProjectData: (projectId: number, projectMergeInput: ProjectMergeInput, options?: RequestInit) => Promise<ProjectSummary>;
export declare const getMergeProjectDataMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergeProjectData>>, TError, {
        projectId: number;
        data: BodyType<ProjectMergeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof mergeProjectData>>, TError, {
    projectId: number;
    data: BodyType<ProjectMergeInput>;
}, TContext>;
export type MergeProjectDataMutationResult = NonNullable<Awaited<ReturnType<typeof mergeProjectData>>>;
export type MergeProjectDataMutationBody = BodyType<ProjectMergeInput>;
export type MergeProjectDataMutationError = ErrorType<unknown>;
/**
 * @summary Append states / sectors / localities to an existing project without duplication
 */
export declare const useMergeProjectData: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergeProjectData>>, TError, {
        projectId: number;
        data: BodyType<ProjectMergeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof mergeProjectData>>, TError, {
    projectId: number;
    data: BodyType<ProjectMergeInput>;
}, TContext>;
export declare const getGetProjectUrl: (projectId: number) => string;
export declare const getProject: (projectId: number, options?: RequestInit) => Promise<ProjectDetail>;
export declare const getGetProjectQueryKey: (projectId: number) => readonly [`/api/projects/${number}`];
export declare const getGetProjectQueryOptions: <TData = Awaited<ReturnType<typeof getProject>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectQueryResult = NonNullable<Awaited<ReturnType<typeof getProject>>>;
export type GetProjectQueryError = ErrorType<unknown>;
export declare function useGetProject<TData = Awaited<ReturnType<typeof getProject>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getScanProjectDonorIntegrityUrl: () => string;
/**
 * Read-only administrator scan. It reports only unlinked values classified as confirmed placeholders and separately identifies the explicit Unknown missing-donor marker; legitimate registered donor names are excluded.

 * @summary Scan submitted, approved, and active projects for confirmed placeholder donors
 */
export declare const scanProjectDonorIntegrity: (options?: RequestInit) => Promise<FocusedProjectDonorScan>;
export declare const getScanProjectDonorIntegrityQueryKey: () => readonly ["/api/projects/donor-integrity-scan"];
export declare const getScanProjectDonorIntegrityQueryOptions: <TData = Awaited<ReturnType<typeof scanProjectDonorIntegrity>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof scanProjectDonorIntegrity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof scanProjectDonorIntegrity>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ScanProjectDonorIntegrityQueryResult = NonNullable<Awaited<ReturnType<typeof scanProjectDonorIntegrity>>>;
export type ScanProjectDonorIntegrityQueryError = ErrorType<void>;
/**
 * @summary Scan submitted, approved, and active projects for confirmed placeholder donors
 */
export declare function useScanProjectDonorIntegrity<TData = Awaited<ReturnType<typeof scanProjectDonorIntegrity>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof scanProjectDonorIntegrity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCorrectProjectDonorUrl: (projectId: number) => string;
/**
 * Restricted administrative correction. The target must be a non-deleted submitted, approved, or active project whose current donor is a confirmed unlinked placeholder. donorId selects a registered donor; null records the explicit Unknown missing-donor state. No status transition occurs.

 * @summary Correct a confirmed placeholder donor without changing project workflow
 */
export declare const correctProjectDonor: (projectId: number, projectDonorCorrectionInput: ProjectDonorCorrectionInput, options?: RequestInit) => Promise<ProjectDonorCorrection>;
export declare const getCorrectProjectDonorMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof correctProjectDonor>>, TError, {
        projectId: number;
        data: BodyType<ProjectDonorCorrectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof correctProjectDonor>>, TError, {
    projectId: number;
    data: BodyType<ProjectDonorCorrectionInput>;
}, TContext>;
export type CorrectProjectDonorMutationResult = NonNullable<Awaited<ReturnType<typeof correctProjectDonor>>>;
export type CorrectProjectDonorMutationBody = BodyType<ProjectDonorCorrectionInput>;
export type CorrectProjectDonorMutationError = ErrorType<void>;
/**
 * @summary Correct a confirmed placeholder donor without changing project workflow
 */
export declare const useCorrectProjectDonor: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof correctProjectDonor>>, TError, {
        projectId: number;
        data: BodyType<ProjectDonorCorrectionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof correctProjectDonor>>, TError, {
    projectId: number;
    data: BodyType<ProjectDonorCorrectionInput>;
}, TContext>;
export declare const getRetireDevelopmentTestProjectUrl: (projectId: number) => string;
/**
 * Development-only maintenance operation for the exact reviewed fixture CAFA-MPLQLM3M / TX Test. It is unavailable in production, requires the projects.delete permission, performs a soft delete only, preserves child records and prior workflow history, and writes a cleanup audit entry.

 * @summary Retire the explicitly reviewed development test project
 */
export declare const retireDevelopmentTestProject: (projectId: number, retireDevelopmentTestProjectBody: RetireDevelopmentTestProjectBody, options?: RequestInit) => Promise<void>;
export declare const getRetireDevelopmentTestProjectMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof retireDevelopmentTestProject>>, TError, {
        projectId: number;
        data: BodyType<RetireDevelopmentTestProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof retireDevelopmentTestProject>>, TError, {
    projectId: number;
    data: BodyType<RetireDevelopmentTestProjectBody>;
}, TContext>;
export type RetireDevelopmentTestProjectMutationResult = NonNullable<Awaited<ReturnType<typeof retireDevelopmentTestProject>>>;
export type RetireDevelopmentTestProjectMutationBody = BodyType<RetireDevelopmentTestProjectBody>;
export type RetireDevelopmentTestProjectMutationError = ErrorType<void>;
/**
 * @summary Retire the explicitly reviewed development test project
 */
export declare const useRetireDevelopmentTestProject: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof retireDevelopmentTestProject>>, TError, {
        projectId: number;
        data: BodyType<RetireDevelopmentTestProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof retireDevelopmentTestProject>>, TError, {
    projectId: number;
    data: BodyType<RetireDevelopmentTestProjectBody>;
}, TContext>;
export declare const getListProjectStateAllocationsUrl: (projectId: number) => string;
/**
 * @summary List per-state budget/target allocations for a project
 */
export declare const listProjectStateAllocations: (projectId: number, options?: RequestInit) => Promise<ProjectStateAllocation[]>;
export declare const getListProjectStateAllocationsQueryKey: (projectId: number) => readonly [`/api/projects/${number}/state-allocations`];
export declare const getListProjectStateAllocationsQueryOptions: <TData = Awaited<ReturnType<typeof listProjectStateAllocations>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectStateAllocations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectStateAllocations>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectStateAllocationsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectStateAllocations>>>;
export type ListProjectStateAllocationsQueryError = ErrorType<unknown>;
/**
 * @summary List per-state budget/target allocations for a project
 */
export declare function useListProjectStateAllocations<TData = Awaited<ReturnType<typeof listProjectStateAllocations>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectStateAllocations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpsertProjectStateAllocationsUrl: (projectId: number) => string;
/**
 * @summary Replace all state allocations for a project
 */
export declare const upsertProjectStateAllocations: (projectId: number, upsertProjectStateAllocationsBody: UpsertProjectStateAllocationsBody, options?: RequestInit) => Promise<ProjectStateAllocation[]>;
export declare const getUpsertProjectStateAllocationsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof upsertProjectStateAllocations>>, TError, {
        projectId: number;
        data: BodyType<UpsertProjectStateAllocationsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof upsertProjectStateAllocations>>, TError, {
    projectId: number;
    data: BodyType<UpsertProjectStateAllocationsBody>;
}, TContext>;
export type UpsertProjectStateAllocationsMutationResult = NonNullable<Awaited<ReturnType<typeof upsertProjectStateAllocations>>>;
export type UpsertProjectStateAllocationsMutationBody = BodyType<UpsertProjectStateAllocationsBody>;
export type UpsertProjectStateAllocationsMutationError = ErrorType<unknown>;
/**
 * @summary Replace all state allocations for a project
 */
export declare const useUpsertProjectStateAllocations: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof upsertProjectStateAllocations>>, TError, {
        projectId: number;
        data: BodyType<UpsertProjectStateAllocationsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof upsertProjectStateAllocations>>, TError, {
    projectId: number;
    data: BodyType<UpsertProjectStateAllocationsBody>;
}, TContext>;
export declare const getTransitionProjectUrl: (projectId: number) => string;
/**
 * @summary Move a project through its approval workflow
 */
export declare const transitionProject: (projectId: number, workflowTransitionInput: WorkflowTransitionInput, options?: RequestInit) => Promise<Project>;
export declare const getTransitionProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionProject>>, TError, {
        projectId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof transitionProject>>, TError, {
    projectId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export type TransitionProjectMutationResult = NonNullable<Awaited<ReturnType<typeof transitionProject>>>;
export type TransitionProjectMutationBody = BodyType<WorkflowTransitionInput>;
export type TransitionProjectMutationError = ErrorType<unknown>;
/**
 * @summary Move a project through its approval workflow
 */
export declare const useTransitionProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionProject>>, TError, {
        projectId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof transitionProject>>, TError, {
    projectId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export declare const getListProjectActivitiesUrl: (projectId: number) => string;
export declare const listProjectActivities: (projectId: number, options?: RequestInit) => Promise<Activity[]>;
export declare const getListProjectActivitiesQueryKey: (projectId: number) => readonly [`/api/projects/${number}/activities`];
export declare const getListProjectActivitiesQueryOptions: <TData = Awaited<ReturnType<typeof listProjectActivities>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectActivities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectActivities>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectActivitiesQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectActivities>>>;
export type ListProjectActivitiesQueryError = ErrorType<unknown>;
export declare function useListProjectActivities<TData = Awaited<ReturnType<typeof listProjectActivities>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectActivities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListProjectIndicatorsUrl: (projectId: number) => string;
export declare const listProjectIndicators: (projectId: number, options?: RequestInit) => Promise<Indicator[]>;
export declare const getListProjectIndicatorsQueryKey: (projectId: number) => readonly [`/api/projects/${number}/indicators`];
export declare const getListProjectIndicatorsQueryOptions: <TData = Awaited<ReturnType<typeof listProjectIndicators>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectIndicators>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectIndicators>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectIndicatorsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectIndicators>>>;
export type ListProjectIndicatorsQueryError = ErrorType<unknown>;
export declare function useListProjectIndicators<TData = Awaited<ReturnType<typeof listProjectIndicators>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectIndicators>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetProjectBudgetUrl: (projectId: number) => string;
/**
 * @summary Hierarchical budget with actuals and burn rate
 */
export declare const getProjectBudget: (projectId: number, options?: RequestInit) => Promise<ProjectBudget>;
export declare const getGetProjectBudgetQueryKey: (projectId: number) => readonly [`/api/projects/${number}/budget`];
export declare const getGetProjectBudgetQueryOptions: <TData = Awaited<ReturnType<typeof getProjectBudget>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectBudget>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectBudget>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectBudgetQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectBudget>>>;
export type GetProjectBudgetQueryError = ErrorType<unknown>;
/**
 * @summary Hierarchical budget with actuals and burn rate
 */
export declare function useGetProjectBudget<TData = Awaited<ReturnType<typeof getProjectBudget>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectBudget>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListBeneficiariesUrl: (params?: ListBeneficiariesParams) => string;
export declare const listBeneficiaries: (params?: ListBeneficiariesParams, options?: RequestInit) => Promise<Beneficiary[]>;
export declare const getListBeneficiariesQueryKey: (params?: ListBeneficiariesParams) => readonly ["/api/beneficiaries", ...ListBeneficiariesParams[]];
export declare const getListBeneficiariesQueryOptions: <TData = Awaited<ReturnType<typeof listBeneficiaries>>, TError = ErrorType<unknown>>(params?: ListBeneficiariesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBeneficiaries>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listBeneficiaries>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListBeneficiariesQueryResult = NonNullable<Awaited<ReturnType<typeof listBeneficiaries>>>;
export type ListBeneficiariesQueryError = ErrorType<unknown>;
export declare function useListBeneficiaries<TData = Awaited<ReturnType<typeof listBeneficiaries>>, TError = ErrorType<unknown>>(params?: ListBeneficiariesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBeneficiaries>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateBeneficiaryUrl: () => string;
export declare const createBeneficiary: (beneficiaryInput: BeneficiaryInput, options?: RequestInit) => Promise<Beneficiary>;
export declare const getCreateBeneficiaryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBeneficiary>>, TError, {
        data: BodyType<BeneficiaryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBeneficiary>>, TError, {
    data: BodyType<BeneficiaryInput>;
}, TContext>;
export type CreateBeneficiaryMutationResult = NonNullable<Awaited<ReturnType<typeof createBeneficiary>>>;
export type CreateBeneficiaryMutationBody = BodyType<BeneficiaryInput>;
export type CreateBeneficiaryMutationError = ErrorType<unknown>;
export declare const useCreateBeneficiary: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBeneficiary>>, TError, {
        data: BodyType<BeneficiaryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBeneficiary>>, TError, {
    data: BodyType<BeneficiaryInput>;
}, TContext>;
export declare const getListRisksUrl: (params?: ListRisksParams) => string;
export declare const listRisks: (params?: ListRisksParams, options?: RequestInit) => Promise<RiskListResponse>;
export declare const getListRisksQueryKey: (params?: ListRisksParams) => readonly ["/api/risks", ...ListRisksParams[]];
export declare const getListRisksQueryOptions: <TData = Awaited<ReturnType<typeof listRisks>>, TError = ErrorType<unknown>>(params?: ListRisksParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listRisks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listRisks>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListRisksQueryResult = NonNullable<Awaited<ReturnType<typeof listRisks>>>;
export type ListRisksQueryError = ErrorType<unknown>;
export declare function useListRisks<TData = Awaited<ReturnType<typeof listRisks>>, TError = ErrorType<unknown>>(params?: ListRisksParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listRisks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateRiskUrl: () => string;
export declare const createRisk: (riskInput: RiskInput, options?: RequestInit) => Promise<Risk>;
export declare const getCreateRiskMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createRisk>>, TError, {
        data: BodyType<RiskInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createRisk>>, TError, {
    data: BodyType<RiskInput>;
}, TContext>;
export type CreateRiskMutationResult = NonNullable<Awaited<ReturnType<typeof createRisk>>>;
export type CreateRiskMutationBody = BodyType<RiskInput>;
export type CreateRiskMutationError = ErrorType<unknown>;
export declare const useCreateRisk: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createRisk>>, TError, {
        data: BodyType<RiskInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createRisk>>, TError, {
    data: BodyType<RiskInput>;
}, TContext>;
export declare const getUpdateRiskUrl: (riskId: number) => string;
export declare const updateRisk: (riskId: number, riskUpdate: RiskUpdate, options?: RequestInit) => Promise<Risk>;
export declare const getUpdateRiskMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateRisk>>, TError, {
        riskId: number;
        data: BodyType<RiskUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateRisk>>, TError, {
    riskId: number;
    data: BodyType<RiskUpdate>;
}, TContext>;
export type UpdateRiskMutationResult = NonNullable<Awaited<ReturnType<typeof updateRisk>>>;
export type UpdateRiskMutationBody = BodyType<RiskUpdate>;
export type UpdateRiskMutationError = ErrorType<unknown>;
export declare const useUpdateRisk: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateRisk>>, TError, {
        riskId: number;
        data: BodyType<RiskUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateRisk>>, TError, {
    riskId: number;
    data: BodyType<RiskUpdate>;
}, TContext>;
export declare const getListReportsUrl: (params?: ListReportsParams) => string;
export declare const listReports: (params?: ListReportsParams, options?: RequestInit) => Promise<ReportPage>;
export declare const getListReportsQueryKey: (params?: ListReportsParams) => readonly ["/api/reports", ...ListReportsParams[]];
export declare const getListReportsQueryOptions: <TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(params?: ListReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportsQueryResult = NonNullable<Awaited<ReturnType<typeof listReports>>>;
export type ListReportsQueryError = ErrorType<unknown>;
export declare function useListReports<TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(params?: ListReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateReportUrl: () => string;
export declare const createReport: (reportInput: ReportInput, options?: RequestInit) => Promise<Report>;
export declare const getCreateReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
        data: BodyType<ReportInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
    data: BodyType<ReportInput>;
}, TContext>;
export type CreateReportMutationResult = NonNullable<Awaited<ReturnType<typeof createReport>>>;
export type CreateReportMutationBody = BodyType<ReportInput>;
export type CreateReportMutationError = ErrorType<unknown>;
export declare const useCreateReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
        data: BodyType<ReportInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createReport>>, TError, {
    data: BodyType<ReportInput>;
}, TContext>;
export declare const getListReportAuthorsUrl: (params?: ListReportAuthorsParams) => string;
/**
 * @summary Scoped unique author facet — returns all unique authors present in the user's authorised Report population for the given non-author filters. Independent of pagination. NULL author_ids are excluded.

 */
export declare const listReportAuthors: (params?: ListReportAuthorsParams, options?: RequestInit) => Promise<ListReportAuthors200>;
export declare const getListReportAuthorsQueryKey: (params?: ListReportAuthorsParams) => readonly ["/api/reports/authors", ...ListReportAuthorsParams[]];
export declare const getListReportAuthorsQueryOptions: <TData = Awaited<ReturnType<typeof listReportAuthors>>, TError = ErrorType<unknown>>(params?: ListReportAuthorsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportAuthors>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReportAuthors>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportAuthorsQueryResult = NonNullable<Awaited<ReturnType<typeof listReportAuthors>>>;
export type ListReportAuthorsQueryError = ErrorType<unknown>;
/**
 * @summary Scoped unique author facet — returns all unique authors present in the user's authorised Report population for the given non-author filters. Independent of pagination. NULL author_ids are excluded.

 */
export declare function useListReportAuthors<TData = Awaited<ReturnType<typeof listReportAuthors>>, TError = ErrorType<unknown>>(params?: ListReportAuthorsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportAuthors>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getExportReportsUrl: (params?: ExportReportsParams) => string;
/**
 * @summary Export all matching reports without pagination limit
 */
export declare const exportReports: (params?: ExportReportsParams, options?: RequestInit) => Promise<Report[]>;
export declare const getExportReportsQueryKey: (params?: ExportReportsParams) => readonly ["/api/reports/export", ...ExportReportsParams[]];
export declare const getExportReportsQueryOptions: <TData = Awaited<ReturnType<typeof exportReports>>, TError = ErrorType<unknown>>(params?: ExportReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof exportReports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ExportReportsQueryResult = NonNullable<Awaited<ReturnType<typeof exportReports>>>;
export type ExportReportsQueryError = ErrorType<unknown>;
/**
 * @summary Export all matching reports without pagination limit
 */
export declare function useExportReports<TData = Awaited<ReturnType<typeof exportReports>>, TError = ErrorType<unknown>>(params?: ExportReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetReportsStatsUrl: () => string;
/**
 * @summary Per-type report counts using canonical status groups
 */
export declare const getReportsStats: (options?: RequestInit) => Promise<ReportStats>;
export declare const getGetReportsStatsQueryKey: () => readonly ["/api/reports/stats"];
export declare const getGetReportsStatsQueryOptions: <TData = Awaited<ReturnType<typeof getReportsStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReportsStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportsStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getReportsStats>>>;
export type GetReportsStatsQueryError = ErrorType<unknown>;
/**
 * @summary Per-type report counts using canonical status groups
 */
export declare function useGetReportsStats<TData = Awaited<ReturnType<typeof getReportsStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCheckReportDuplicateUrl: (params: CheckReportDuplicateParams) => string;
/**
 * @summary Check if a report already exists for the given project/state/period combination
 */
export declare const checkReportDuplicate: (params: CheckReportDuplicateParams, options?: RequestInit) => Promise<ReportDuplicateCheck>;
export declare const getCheckReportDuplicateQueryKey: (params?: CheckReportDuplicateParams) => readonly ["/api/reports/duplicate-check", ...CheckReportDuplicateParams[]];
export declare const getCheckReportDuplicateQueryOptions: <TData = Awaited<ReturnType<typeof checkReportDuplicate>>, TError = ErrorType<unknown>>(params: CheckReportDuplicateParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof checkReportDuplicate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof checkReportDuplicate>>, TError, TData> & {
    queryKey: QueryKey;
};
export type CheckReportDuplicateQueryResult = NonNullable<Awaited<ReturnType<typeof checkReportDuplicate>>>;
export type CheckReportDuplicateQueryError = ErrorType<unknown>;
/**
 * @summary Check if a report already exists for the given project/state/period combination
 */
export declare function useCheckReportDuplicate<TData = Awaited<ReturnType<typeof checkReportDuplicate>>, TError = ErrorType<unknown>>(params: CheckReportDuplicateParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof checkReportDuplicate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getTransitionReportUrl: (reportId: number) => string;
export declare const transitionReport: (reportId: number, workflowTransitionInput: WorkflowTransitionInput, options?: RequestInit) => Promise<Report>;
export declare const getTransitionReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionReport>>, TError, {
        reportId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof transitionReport>>, TError, {
    reportId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export type TransitionReportMutationResult = NonNullable<Awaited<ReturnType<typeof transitionReport>>>;
export type TransitionReportMutationBody = BodyType<WorkflowTransitionInput>;
export type TransitionReportMutationError = ErrorType<unknown>;
export declare const useTransitionReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionReport>>, TError, {
        reportId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof transitionReport>>, TError, {
    reportId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export declare const getGetReportAggregatesUrl: (reportId: number) => string;
/**
 * @summary Auto-pulled project data for a report (beneficiaries, budget, activities, indicators, risks)
 */
export declare const getReportAggregates: (reportId: number, options?: RequestInit) => Promise<ReportAggregates>;
export declare const getGetReportAggregatesQueryKey: (reportId: number) => readonly [`/api/reports/${number}/aggregates`];
export declare const getGetReportAggregatesQueryOptions: <TData = Awaited<ReturnType<typeof getReportAggregates>>, TError = ErrorType<unknown>>(reportId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportAggregates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReportAggregates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportAggregatesQueryResult = NonNullable<Awaited<ReturnType<typeof getReportAggregates>>>;
export type GetReportAggregatesQueryError = ErrorType<unknown>;
/**
 * @summary Auto-pulled project data for a report (beneficiaries, budget, activities, indicators, risks)
 */
export declare function useGetReportAggregates<TData = Awaited<ReturnType<typeof getReportAggregates>>, TError = ErrorType<unknown>>(reportId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportAggregates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetReportsSummaryUrl: () => string;
/**
 * @summary Reports KPIs and breakdowns by state/sector/type
 */
export declare const getReportsSummary: (options?: RequestInit) => Promise<ReportsSummary>;
export declare const getGetReportsSummaryQueryKey: () => readonly ["/api/dashboard/reports-summary"];
export declare const getGetReportsSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getReportsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReportsSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportsSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getReportsSummary>>>;
export type GetReportsSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Reports KPIs and breakdowns by state/sector/type
 */
export declare function useGetReportsSummary<TData = Awaited<ReturnType<typeof getReportsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardSummaryUrl: (params?: GetDashboardSummaryParams) => string;
/**
 * @summary Organization-wide KPIs
 */
export declare const getDashboardSummary: (params?: GetDashboardSummaryParams, options?: RequestInit) => Promise<DashboardSummary>;
export declare const getGetDashboardSummaryQueryKey: (params?: GetDashboardSummaryParams) => readonly ["/api/dashboard/summary", ...GetDashboardSummaryParams[]];
export declare const getGetDashboardSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardSummary>>, TError = ErrorType<unknown>>(params?: GetDashboardSummaryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardSummary>>>;
export type GetDashboardSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Organization-wide KPIs
 */
export declare function useGetDashboardSummary<TData = Awaited<ReturnType<typeof getDashboardSummary>>, TError = ErrorType<unknown>>(params?: GetDashboardSummaryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetStatePerformanceUrl: (params?: GetStatePerformanceParams) => string;
export declare const getStatePerformance: (params?: GetStatePerformanceParams, options?: RequestInit) => Promise<StatePerformance[]>;
export declare const getGetStatePerformanceQueryKey: (params?: GetStatePerformanceParams) => readonly ["/api/dashboard/state-performance", ...GetStatePerformanceParams[]];
export declare const getGetStatePerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getStatePerformance>>, TError = ErrorType<unknown>>(params?: GetStatePerformanceParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStatePerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStatePerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStatePerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getStatePerformance>>>;
export type GetStatePerformanceQueryError = ErrorType<unknown>;
export declare function useGetStatePerformance<TData = Awaited<ReturnType<typeof getStatePerformance>>, TError = ErrorType<unknown>>(params?: GetStatePerformanceParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStatePerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardNotificationsSummaryUrl: () => string;
/**
 * @summary Unread notification counts by module for dashboard widget
 */
export declare const getDashboardNotificationsSummary: (options?: RequestInit) => Promise<DashboardNotificationsSummary>;
export declare const getGetDashboardNotificationsSummaryQueryKey: () => readonly ["/api/dashboard/notifications-summary"];
export declare const getGetDashboardNotificationsSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardNotificationsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardNotificationsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardNotificationsSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardNotificationsSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardNotificationsSummary>>>;
export type GetDashboardNotificationsSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Unread notification counts by module for dashboard widget
 */
export declare function useGetDashboardNotificationsSummary<TData = Awaited<ReturnType<typeof getDashboardNotificationsSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardNotificationsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSectorPerformanceUrl: () => string;
export declare const getSectorPerformance: (options?: RequestInit) => Promise<SectorPerformance[]>;
export declare const getGetSectorPerformanceQueryKey: () => readonly ["/api/dashboard/sector-performance"];
export declare const getGetSectorPerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getSectorPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSectorPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSectorPerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSectorPerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getSectorPerformance>>>;
export type GetSectorPerformanceQueryError = ErrorType<unknown>;
export declare function useGetSectorPerformance<TData = Awaited<ReturnType<typeof getSectorPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSectorPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetBeneficiariesBreakdownUrl: () => string;
/**
 * @summary Beneficiary segregation aggregated from project forms
 */
export declare const getBeneficiariesBreakdown: (options?: RequestInit) => Promise<BeneficiariesBreakdown>;
export declare const getGetBeneficiariesBreakdownQueryKey: () => readonly ["/api/dashboard/beneficiaries"];
export declare const getGetBeneficiariesBreakdownQueryOptions: <TData = Awaited<ReturnType<typeof getBeneficiariesBreakdown>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBeneficiariesBreakdown>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBeneficiariesBreakdown>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBeneficiariesBreakdownQueryResult = NonNullable<Awaited<ReturnType<typeof getBeneficiariesBreakdown>>>;
export type GetBeneficiariesBreakdownQueryError = ErrorType<unknown>;
/**
 * @summary Beneficiary segregation aggregated from project forms
 */
export declare function useGetBeneficiariesBreakdown<TData = Awaited<ReturnType<typeof getBeneficiariesBreakdown>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBeneficiariesBreakdown>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPendingApprovalsUrl: () => string;
/**
 * @summary Items waiting on the current user's approval
 */
export declare const getPendingApprovals: (options?: RequestInit) => Promise<PendingApprovals>;
export declare const getGetPendingApprovalsQueryKey: () => readonly ["/api/dashboard/pending-approvals"];
export declare const getGetPendingApprovalsQueryOptions: <TData = Awaited<ReturnType<typeof getPendingApprovals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPendingApprovals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPendingApprovals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPendingApprovalsQueryResult = NonNullable<Awaited<ReturnType<typeof getPendingApprovals>>>;
export type GetPendingApprovalsQueryError = ErrorType<unknown>;
/**
 * @summary Items waiting on the current user's approval
 */
export declare function useGetPendingApprovals<TData = Awaited<ReturnType<typeof getPendingApprovals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPendingApprovals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetRecentActivityUrl: () => string;
export declare const getRecentActivity: (options?: RequestInit) => Promise<ActivityEntry[]>;
export declare const getGetRecentActivityQueryKey: () => readonly ["/api/dashboard/recent-activity"];
export declare const getGetRecentActivityQueryOptions: <TData = Awaited<ReturnType<typeof getRecentActivity>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRecentActivity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRecentActivity>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRecentActivityQueryResult = NonNullable<Awaited<ReturnType<typeof getRecentActivity>>>;
export type GetRecentActivityQueryError = ErrorType<unknown>;
export declare function useGetRecentActivity<TData = Awaited<ReturnType<typeof getRecentActivity>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRecentActivity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDonorPortfolioUrl: () => string;
export declare const getDonorPortfolio: (options?: RequestInit) => Promise<DonorPortfolioEntry[]>;
export declare const getGetDonorPortfolioQueryKey: () => readonly ["/api/dashboard/donor-portfolio"];
export declare const getGetDonorPortfolioQueryOptions: <TData = Awaited<ReturnType<typeof getDonorPortfolio>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDonorPortfolio>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDonorPortfolio>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDonorPortfolioQueryResult = NonNullable<Awaited<ReturnType<typeof getDonorPortfolio>>>;
export type GetDonorPortfolioQueryError = ErrorType<unknown>;
export declare function useGetDonorPortfolio<TData = Awaited<ReturnType<typeof getDonorPortfolio>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDonorPortfolio>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetProjectBudgetPerformanceUrl: () => string;
/**
 * @summary Per-project budget performance (allocated, spent, remaining, utilisation) scoped by role
 */
export declare const getProjectBudgetPerformance: (options?: RequestInit) => Promise<ProjectBudgetPerformanceEntry[]>;
export declare const getGetProjectBudgetPerformanceQueryKey: () => readonly ["/api/dashboard/project-budget-performance"];
export declare const getGetProjectBudgetPerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getProjectBudgetPerformance>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectBudgetPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectBudgetPerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectBudgetPerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectBudgetPerformance>>>;
export type GetProjectBudgetPerformanceQueryError = ErrorType<void>;
/**
 * @summary Per-project budget performance (allocated, spent, remaining, utilisation) scoped by role
 */
export declare function useGetProjectBudgetPerformance<TData = Awaited<ReturnType<typeof getProjectBudgetPerformance>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectBudgetPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSectorBudgetUrl: (params?: GetSectorBudgetParams) => string;
/**
 * @summary Budget aggregates grouped by sector with optional filters
 */
export declare const getSectorBudget: (params?: GetSectorBudgetParams, options?: RequestInit) => Promise<SectorBudgetResponse>;
export declare const getGetSectorBudgetQueryKey: (params?: GetSectorBudgetParams) => readonly ["/api/dashboard/sector-budget", ...GetSectorBudgetParams[]];
export declare const getGetSectorBudgetQueryOptions: <TData = Awaited<ReturnType<typeof getSectorBudget>>, TError = ErrorType<unknown>>(params?: GetSectorBudgetParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSectorBudget>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSectorBudget>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSectorBudgetQueryResult = NonNullable<Awaited<ReturnType<typeof getSectorBudget>>>;
export type GetSectorBudgetQueryError = ErrorType<unknown>;
/**
 * @summary Budget aggregates grouped by sector with optional filters
 */
export declare function useGetSectorBudget<TData = Awaited<ReturnType<typeof getSectorBudget>>, TError = ErrorType<unknown>>(params?: GetSectorBudgetParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSectorBudget>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardAgendaUrl: () => string;
/**
 * @summary Upcoming deadlines, pending approvals, and schedule items across projects/plans/reports
 */
export declare const getDashboardAgenda: (options?: RequestInit) => Promise<DashboardAgenda>;
export declare const getGetDashboardAgendaQueryKey: () => readonly ["/api/dashboard/agenda"];
export declare const getGetDashboardAgendaQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardAgenda>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardAgenda>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardAgenda>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardAgendaQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardAgenda>>>;
export type GetDashboardAgendaQueryError = ErrorType<unknown>;
/**
 * @summary Upcoming deadlines, pending approvals, and schedule items across projects/plans/reports
 */
export declare function useGetDashboardAgenda<TData = Awaited<ReturnType<typeof getDashboardAgenda>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardAgenda>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardPerformanceUrl: () => string;
/**
 * @summary Organization-wide (or scoped) 6-component weighted performance score
 */
export declare const getDashboardPerformance: (options?: RequestInit) => Promise<PerformanceScore>;
export declare const getGetDashboardPerformanceQueryKey: () => readonly ["/api/dashboard/performance"];
export declare const getGetDashboardPerformanceQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardPerformanceQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardPerformance>>>;
export type GetDashboardPerformanceQueryError = ErrorType<unknown>;
/**
 * @summary Organization-wide (or scoped) 6-component weighted performance score
 */
export declare function useGetDashboardPerformance<TData = Awaited<ReturnType<typeof getDashboardPerformance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardPerformanceStatesUrl: () => string;
/**
 * @summary Per-state performance scores sorted by rank (descending)
 */
export declare const getDashboardPerformanceStates: (options?: RequestInit) => Promise<StatePerformance[]>;
export declare const getGetDashboardPerformanceStatesQueryKey: () => readonly ["/api/dashboard/performance/states"];
export declare const getGetDashboardPerformanceStatesQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardPerformanceStates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceStates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceStates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardPerformanceStatesQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardPerformanceStates>>>;
export type GetDashboardPerformanceStatesQueryError = ErrorType<unknown>;
/**
 * @summary Per-state performance scores sorted by rank (descending)
 */
export declare function useGetDashboardPerformanceStates<TData = Awaited<ReturnType<typeof getDashboardPerformanceStates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceStates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardPerformanceProjectsUrl: (params?: GetDashboardPerformanceProjectsParams) => string;
/**
 * @summary Per-project performance scores sorted by rank (descending)
 */
export declare const getDashboardPerformanceProjects: (params?: GetDashboardPerformanceProjectsParams, options?: RequestInit) => Promise<ProjectPerformanceScore[]>;
export declare const getGetDashboardPerformanceProjectsQueryKey: (params?: GetDashboardPerformanceProjectsParams) => readonly ["/api/dashboard/performance/projects", ...GetDashboardPerformanceProjectsParams[]];
export declare const getGetDashboardPerformanceProjectsQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardPerformanceProjects>>, TError = ErrorType<unknown>>(params?: GetDashboardPerformanceProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceProjects>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardPerformanceProjectsQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardPerformanceProjects>>>;
export type GetDashboardPerformanceProjectsQueryError = ErrorType<unknown>;
/**
 * @summary Per-project performance scores sorted by rank (descending)
 */
export declare function useGetDashboardPerformanceProjects<TData = Awaited<ReturnType<typeof getDashboardPerformanceProjects>>, TError = ErrorType<unknown>>(params?: GetDashboardPerformanceProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardPerformanceProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardAttentionProjectsUrl: () => string;
/**
 * @summary Projects requiring follow-up (draft, returned, awaiting approval, critical risks, overdue mitigations)
 */
export declare const getDashboardAttentionProjects: (options?: RequestInit) => Promise<FollowUpProject[]>;
export declare const getGetDashboardAttentionProjectsQueryKey: () => readonly ["/api/dashboard/attention-projects"];
export declare const getGetDashboardAttentionProjectsQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardAttentionProjects>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardAttentionProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardAttentionProjects>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardAttentionProjectsQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardAttentionProjects>>>;
export type GetDashboardAttentionProjectsQueryError = ErrorType<unknown>;
/**
 * @summary Projects requiring follow-up (draft, returned, awaiting approval, critical risks, overdue mitigations)
 */
export declare function useGetDashboardAttentionProjects<TData = Awaited<ReturnType<typeof getDashboardAttentionProjects>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardAttentionProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetDashboardLateReportsUrl: () => string;
/**
 * @summary Reports pending more than 14 days without approval
 */
export declare const getDashboardLateReports: (options?: RequestInit) => Promise<LateReport[]>;
export declare const getGetDashboardLateReportsQueryKey: () => readonly ["/api/dashboard/late-reports"];
export declare const getGetDashboardLateReportsQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardLateReports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardLateReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardLateReports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardLateReportsQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardLateReports>>>;
export type GetDashboardLateReportsQueryError = ErrorType<unknown>;
/**
 * @summary Reports pending more than 14 days without approval
 */
export declare function useGetDashboardLateReports<TData = Awaited<ReturnType<typeof getDashboardLateReports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardLateReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPmrReportingCompletenessUrl: (params: GetPmrReportingCompletenessParams) => string;
/**
 * @summary PMR reporting completeness — which expected operational locations have submitted for a period
 */
export declare const getPmrReportingCompleteness: (params: GetPmrReportingCompletenessParams, options?: RequestInit) => Promise<PmrReportingCompleteness>;
export declare const getGetPmrReportingCompletenessQueryKey: (params?: GetPmrReportingCompletenessParams) => readonly ["/api/dashboard/pmr-reporting-completeness", ...GetPmrReportingCompletenessParams[]];
export declare const getGetPmrReportingCompletenessQueryOptions: <TData = Awaited<ReturnType<typeof getPmrReportingCompleteness>>, TError = ErrorType<void>>(params: GetPmrReportingCompletenessParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPmrReportingCompleteness>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPmrReportingCompleteness>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPmrReportingCompletenessQueryResult = NonNullable<Awaited<ReturnType<typeof getPmrReportingCompleteness>>>;
export type GetPmrReportingCompletenessQueryError = ErrorType<void>;
/**
 * @summary PMR reporting completeness — which expected operational locations have submitted for a period
 */
export declare function useGetPmrReportingCompleteness<TData = Awaited<ReturnType<typeof getPmrReportingCompleteness>>, TError = ErrorType<void>>(params: GetPmrReportingCompletenessParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPmrReportingCompleteness>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetConsolidatedProjectReportUrl: (params: GetConsolidatedProjectReportParams) => string;
/**
 * @summary Consolidated Project View — all locations' PMRs for one project + frequency + period (read model)
 */
export declare const getConsolidatedProjectReport: (params: GetConsolidatedProjectReportParams, options?: RequestInit) => Promise<ConsolidatedProjectReport>;
export declare const getGetConsolidatedProjectReportQueryKey: (params?: GetConsolidatedProjectReportParams) => readonly ["/api/reports/consolidated", ...GetConsolidatedProjectReportParams[]];
export declare const getGetConsolidatedProjectReportQueryOptions: <TData = Awaited<ReturnType<typeof getConsolidatedProjectReport>>, TError = ErrorType<void>>(params: GetConsolidatedProjectReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConsolidatedProjectReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getConsolidatedProjectReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetConsolidatedProjectReportQueryResult = NonNullable<Awaited<ReturnType<typeof getConsolidatedProjectReport>>>;
export type GetConsolidatedProjectReportQueryError = ErrorType<void>;
/**
 * @summary Consolidated Project View — all locations' PMRs for one project + frequency + period (read model)
 */
export declare function useGetConsolidatedProjectReport<TData = Awaited<ReturnType<typeof getConsolidatedProjectReport>>, TError = ErrorType<void>>(params: GetConsolidatedProjectReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConsolidatedProjectReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListLocalitiesUrl: (params?: ListLocalitiesParams) => string;
/**
 * @summary List all localities (optionally filter by stateId)
 */
export declare const listLocalities: (params?: ListLocalitiesParams, options?: RequestInit) => Promise<LocalityWithState[]>;
export declare const getListLocalitiesQueryKey: (params?: ListLocalitiesParams) => readonly ["/api/localities", ...ListLocalitiesParams[]];
export declare const getListLocalitiesQueryOptions: <TData = Awaited<ReturnType<typeof listLocalities>>, TError = ErrorType<unknown>>(params?: ListLocalitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLocalities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listLocalities>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListLocalitiesQueryResult = NonNullable<Awaited<ReturnType<typeof listLocalities>>>;
export type ListLocalitiesQueryError = ErrorType<unknown>;
/**
 * @summary List all localities (optionally filter by stateId)
 */
export declare function useListLocalities<TData = Awaited<ReturnType<typeof listLocalities>>, TError = ErrorType<unknown>>(params?: ListLocalitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLocalities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListProjectDocumentsUrl: (projectId: number) => string;
export declare const listProjectDocuments: (projectId: number, options?: RequestInit) => Promise<ProjectDocument[]>;
export declare const getListProjectDocumentsQueryKey: (projectId: number) => readonly [`/api/projects/${number}/documents`];
export declare const getListProjectDocumentsQueryOptions: <TData = Awaited<ReturnType<typeof listProjectDocuments>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectDocuments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectDocumentsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectDocuments>>>;
export type ListProjectDocumentsQueryError = ErrorType<unknown>;
export declare function useListProjectDocuments<TData = Awaited<ReturnType<typeof listProjectDocuments>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getAddProjectDocumentUrl: (projectId: number) => string;
/**
 * @summary Attach an already-uploaded object as a project document
 */
export declare const addProjectDocument: (projectId: number, projectDocumentInput: ProjectDocumentInput, options?: RequestInit) => Promise<ProjectDocument>;
export declare const getAddProjectDocumentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addProjectDocument>>, TError, {
        projectId: number;
        data: BodyType<ProjectDocumentInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addProjectDocument>>, TError, {
    projectId: number;
    data: BodyType<ProjectDocumentInput>;
}, TContext>;
export type AddProjectDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof addProjectDocument>>>;
export type AddProjectDocumentMutationBody = BodyType<ProjectDocumentInput>;
export type AddProjectDocumentMutationError = ErrorType<unknown>;
/**
 * @summary Attach an already-uploaded object as a project document
 */
export declare const useAddProjectDocument: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addProjectDocument>>, TError, {
        projectId: number;
        data: BodyType<ProjectDocumentInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addProjectDocument>>, TError, {
    projectId: number;
    data: BodyType<ProjectDocumentInput>;
}, TContext>;
export declare const getDeleteProjectDocumentUrl: (projectId: number, documentId: number) => string;
export declare const deleteProjectDocument: (projectId: number, documentId: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteProjectDocumentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProjectDocument>>, TError, {
        projectId: number;
        documentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteProjectDocument>>, TError, {
    projectId: number;
    documentId: number;
}, TContext>;
export type DeleteProjectDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof deleteProjectDocument>>>;
export type DeleteProjectDocumentMutationError = ErrorType<unknown>;
export declare const useDeleteProjectDocument: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProjectDocument>>, TError, {
        projectId: number;
        documentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteProjectDocument>>, TError, {
    projectId: number;
    documentId: number;
}, TContext>;
export declare const getListReportAttachmentsUrl: (reportId: number) => string;
/**
 * @summary List attachment metadata for an authorised report
 */
export declare const listReportAttachments: (reportId: number, options?: RequestInit) => Promise<ReportAttachment[]>;
export declare const getListReportAttachmentsQueryKey: (reportId: number) => readonly [`/api/reports/${number}/attachments`];
export declare const getListReportAttachmentsQueryOptions: <TData = Awaited<ReturnType<typeof listReportAttachments>>, TError = ErrorType<unknown>>(reportId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReportAttachments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportAttachmentsQueryResult = NonNullable<Awaited<ReturnType<typeof listReportAttachments>>>;
export type ListReportAttachmentsQueryError = ErrorType<unknown>;
/**
 * @summary List attachment metadata for an authorised report
 */
export declare function useListReportAttachments<TData = Awaited<ReturnType<typeof listReportAttachments>>, TError = ErrorType<unknown>>(reportId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateReportAttachmentUrl: (reportId: number) => string;
/**
 * @summary Register an uploaded attachment against an authorised draft report
 */
export declare const createReportAttachment: (reportId: number, reportAttachmentInput: ReportAttachmentInput, options?: RequestInit) => Promise<ReportAttachment>;
export declare const getCreateReportAttachmentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReportAttachment>>, TError, {
        reportId: number;
        data: BodyType<ReportAttachmentInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createReportAttachment>>, TError, {
    reportId: number;
    data: BodyType<ReportAttachmentInput>;
}, TContext>;
export type CreateReportAttachmentMutationResult = NonNullable<Awaited<ReturnType<typeof createReportAttachment>>>;
export type CreateReportAttachmentMutationBody = BodyType<ReportAttachmentInput>;
export type CreateReportAttachmentMutationError = ErrorType<unknown>;
/**
 * @summary Register an uploaded attachment against an authorised draft report
 */
export declare const useCreateReportAttachment: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReportAttachment>>, TError, {
        reportId: number;
        data: BodyType<ReportAttachmentInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createReportAttachment>>, TError, {
    reportId: number;
    data: BodyType<ReportAttachmentInput>;
}, TContext>;
export declare const getListArchiveFilesUrl: (params?: ListArchiveFilesParams) => string;
/**
 * @summary List authorised File & Archive metadata
 */
export declare const listArchiveFiles: (params?: ListArchiveFilesParams, options?: RequestInit) => Promise<ArchiveFileListResponse>;
export declare const getListArchiveFilesQueryKey: (params?: ListArchiveFilesParams) => readonly ["/api/files", ...ListArchiveFilesParams[]];
export declare const getListArchiveFilesQueryOptions: <TData = Awaited<ReturnType<typeof listArchiveFiles>>, TError = ErrorType<unknown>>(params?: ListArchiveFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listArchiveFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listArchiveFiles>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListArchiveFilesQueryResult = NonNullable<Awaited<ReturnType<typeof listArchiveFiles>>>;
export type ListArchiveFilesQueryError = ErrorType<unknown>;
/**
 * @summary List authorised File & Archive metadata
 */
export declare function useListArchiveFiles<TData = Awaited<ReturnType<typeof listArchiveFiles>>, TError = ErrorType<unknown>>(params?: ListArchiveFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listArchiveFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRequestUploadUrlUrl: () => string;
/**
 * @summary Request a presigned URL for direct-to-GCS upload
 */
export declare const requestUploadUrl: (uploadUrlRequest: UploadUrlRequest, options?: RequestInit) => Promise<UploadUrlResponse>;
export declare const getRequestUploadUrlMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
export type RequestUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestUploadUrl>>>;
export type RequestUploadUrlMutationBody = BodyType<UploadUrlRequest>;
export type RequestUploadUrlMutationError = ErrorType<unknown>;
/**
 * @summary Request a presigned URL for direct-to-GCS upload
 */
export declare const useRequestUploadUrl: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
export declare const getRequestAttachmentUploadDescriptorUrl: () => string;
/**
 * The descriptor is bound to the authenticated user and canonical Plan or Risk parent. It contains no reusable storage credentials or object key; it must only be used to upload the declared file and complete this operation. Client-supplied parent state, sector, and project metadata are not accepted.

 * @summary Request a short-lived, parent-bound attachment upload descriptor
 */
export declare const requestAttachmentUploadDescriptor: (attachmentUploadDescriptorRequest: AttachmentUploadDescriptorRequest, options?: RequestInit) => Promise<AttachmentUploadDescriptor>;
export declare const getRequestAttachmentUploadDescriptorMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestAttachmentUploadDescriptor>>, TError, {
        data: BodyType<AttachmentUploadDescriptorRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestAttachmentUploadDescriptor>>, TError, {
    data: BodyType<AttachmentUploadDescriptorRequest>;
}, TContext>;
export type RequestAttachmentUploadDescriptorMutationResult = NonNullable<Awaited<ReturnType<typeof requestAttachmentUploadDescriptor>>>;
export type RequestAttachmentUploadDescriptorMutationBody = BodyType<AttachmentUploadDescriptorRequest>;
export type RequestAttachmentUploadDescriptorMutationError = ErrorType<void>;
/**
 * @summary Request a short-lived, parent-bound attachment upload descriptor
 */
export declare const useRequestAttachmentUploadDescriptor: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestAttachmentUploadDescriptor>>, TError, {
        data: BodyType<AttachmentUploadDescriptorRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestAttachmentUploadDescriptor>>, TError, {
    data: BodyType<AttachmentUploadDescriptorRequest>;
}, TContext>;
export declare const getFinalizeAttachmentUploadUrl: (operationId: string) => string;
/**
 * @summary Verify and finalise one parent-bound attachment upload
 */
export declare const finalizeAttachmentUpload: (operationId: string, attachmentUploadFinalizationRequest: AttachmentUploadFinalizationRequest, options?: RequestInit) => Promise<CanonicalAttachment>;
export declare const getFinalizeAttachmentUploadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof finalizeAttachmentUpload>>, TError, {
        operationId: string;
        data: BodyType<AttachmentUploadFinalizationRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof finalizeAttachmentUpload>>, TError, {
    operationId: string;
    data: BodyType<AttachmentUploadFinalizationRequest>;
}, TContext>;
export type FinalizeAttachmentUploadMutationResult = NonNullable<Awaited<ReturnType<typeof finalizeAttachmentUpload>>>;
export type FinalizeAttachmentUploadMutationBody = BodyType<AttachmentUploadFinalizationRequest>;
export type FinalizeAttachmentUploadMutationError = ErrorType<void>;
/**
 * @summary Verify and finalise one parent-bound attachment upload
 */
export declare const useFinalizeAttachmentUpload: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof finalizeAttachmentUpload>>, TError, {
        operationId: string;
        data: BodyType<AttachmentUploadFinalizationRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof finalizeAttachmentUpload>>, TError, {
    operationId: string;
    data: BodyType<AttachmentUploadFinalizationRequest>;
}, TContext>;
export declare const getListPlanAttachmentsUrl: (planId: number) => string;
/**
 * @summary List canonical attachments authorised through their Plan parent
 */
export declare const listPlanAttachments: (planId: number, options?: RequestInit) => Promise<CanonicalAttachmentList>;
export declare const getListPlanAttachmentsQueryKey: (planId: number) => readonly [`/api/plans/${number}/attachments`];
export declare const getListPlanAttachmentsQueryOptions: <TData = Awaited<ReturnType<typeof listPlanAttachments>>, TError = ErrorType<void>>(planId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPlanAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPlanAttachments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPlanAttachmentsQueryResult = NonNullable<Awaited<ReturnType<typeof listPlanAttachments>>>;
export type ListPlanAttachmentsQueryError = ErrorType<void>;
/**
 * @summary List canonical attachments authorised through their Plan parent
 */
export declare function useListPlanAttachments<TData = Awaited<ReturnType<typeof listPlanAttachments>>, TError = ErrorType<void>>(planId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPlanAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListRiskAttachmentsUrl: (riskId: number) => string;
/**
 * @summary List canonical attachments authorised through their Risk parent
 */
export declare const listRiskAttachments: (riskId: number, options?: RequestInit) => Promise<CanonicalAttachmentList>;
export declare const getListRiskAttachmentsQueryKey: (riskId: number) => readonly [`/api/risks/${number}/attachments`];
export declare const getListRiskAttachmentsQueryOptions: <TData = Awaited<ReturnType<typeof listRiskAttachments>>, TError = ErrorType<void>>(riskId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listRiskAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listRiskAttachments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListRiskAttachmentsQueryResult = NonNullable<Awaited<ReturnType<typeof listRiskAttachments>>>;
export type ListRiskAttachmentsQueryError = ErrorType<void>;
/**
 * @summary List canonical attachments authorised through their Risk parent
 */
export declare function useListRiskAttachments<TData = Awaited<ReturnType<typeof listRiskAttachments>>, TError = ErrorType<void>>(riskId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listRiskAttachments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDownloadAttachmentUrl: (attachmentId: number) => string;
/**
 * @summary Download a canonical attachment through the authorised parent proxy
 */
export declare const downloadAttachment: (attachmentId: number, options?: RequestInit) => Promise<void>;
export declare const getDownloadAttachmentQueryKey: (attachmentId: number) => readonly [`/api/attachments/${number}/download`];
export declare const getDownloadAttachmentQueryOptions: <TData = Awaited<ReturnType<typeof downloadAttachment>>, TError = ErrorType<void>>(attachmentId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadAttachment>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadAttachmentQueryResult = NonNullable<Awaited<ReturnType<typeof downloadAttachment>>>;
export type DownloadAttachmentQueryError = ErrorType<void>;
/**
 * @summary Download a canonical attachment through the authorised parent proxy
 */
export declare function useDownloadAttachment<TData = Awaited<ReturnType<typeof downloadAttachment>>, TError = ErrorType<void>>(attachmentId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPreviewAttachmentUrl: (attachmentId: number) => string;
/**
 * @summary Preview a canonical attachment through the authorised parent proxy
 */
export declare const previewAttachment: (attachmentId: number, options?: RequestInit) => Promise<void>;
export declare const getPreviewAttachmentQueryKey: (attachmentId: number) => readonly [`/api/attachments/${number}/preview`];
export declare const getPreviewAttachmentQueryOptions: <TData = Awaited<ReturnType<typeof previewAttachment>>, TError = ErrorType<void>>(attachmentId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof previewAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof previewAttachment>>, TError, TData> & {
    queryKey: QueryKey;
};
export type PreviewAttachmentQueryResult = NonNullable<Awaited<ReturnType<typeof previewAttachment>>>;
export type PreviewAttachmentQueryError = ErrorType<void>;
/**
 * @summary Preview a canonical attachment through the authorised parent proxy
 */
export declare function usePreviewAttachment<TData = Awaited<ReturnType<typeof previewAttachment>>, TError = ErrorType<void>>(attachmentId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof previewAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getArchiveAttachmentUrl: (attachmentId: number) => string;
/**
 * @summary Archive a canonical attachment without exposing its storage identity
 */
export declare const archiveAttachment: (attachmentId: number, options?: RequestInit) => Promise<AttachmentLifecycleResult>;
export declare const getArchiveAttachmentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof archiveAttachment>>, TError, {
        attachmentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof archiveAttachment>>, TError, {
    attachmentId: number;
}, TContext>;
export type ArchiveAttachmentMutationResult = NonNullable<Awaited<ReturnType<typeof archiveAttachment>>>;
export type ArchiveAttachmentMutationError = ErrorType<void>;
/**
 * @summary Archive a canonical attachment without exposing its storage identity
 */
export declare const useArchiveAttachment: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof archiveAttachment>>, TError, {
        attachmentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof archiveAttachment>>, TError, {
    attachmentId: number;
}, TContext>;
export declare const getRemoveAttachmentUrl: (attachmentId: number) => string;
/**
 * @summary Remove canonical attachment metadata and safely clean up its object
 */
export declare const removeAttachment: (attachmentId: number, options?: RequestInit) => Promise<AttachmentLifecycleResult>;
export declare const getRemoveAttachmentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeAttachment>>, TError, {
        attachmentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof removeAttachment>>, TError, {
    attachmentId: number;
}, TContext>;
export type RemoveAttachmentMutationResult = NonNullable<Awaited<ReturnType<typeof removeAttachment>>>;
export type RemoveAttachmentMutationError = ErrorType<void>;
/**
 * @summary Remove canonical attachment metadata and safely clean up its object
 */
export declare const useRemoveAttachment: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeAttachment>>, TError, {
        attachmentId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof removeAttachment>>, TError, {
    attachmentId: number;
}, TContext>;
export declare const getListAttachmentReconciliationEntriesUrl: (params?: ListAttachmentReconciliationEntriesParams) => string;
/**
 * @summary List owner-visible legacy attachment reconciliation entries
 */
export declare const listAttachmentReconciliationEntries: (params?: ListAttachmentReconciliationEntriesParams, options?: RequestInit) => Promise<AttachmentReconciliationListResponse>;
export declare const getListAttachmentReconciliationEntriesQueryKey: (params?: ListAttachmentReconciliationEntriesParams) => readonly ["/api/attachment-reconciliation", ...ListAttachmentReconciliationEntriesParams[]];
export declare const getListAttachmentReconciliationEntriesQueryOptions: <TData = Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>, TError = ErrorType<unknown>>(params?: ListAttachmentReconciliationEntriesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAttachmentReconciliationEntriesQueryResult = NonNullable<Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>>;
export type ListAttachmentReconciliationEntriesQueryError = ErrorType<unknown>;
/**
 * @summary List owner-visible legacy attachment reconciliation entries
 */
export declare function useListAttachmentReconciliationEntries<TData = Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>, TError = ErrorType<unknown>>(params?: ListAttachmentReconciliationEntriesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAttachmentReconciliationEntries>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAttachmentReconciliationReportUrl: (params?: GetAttachmentReconciliationReportParams) => string;
/**
 * @summary Get aggregate reconciliation evidence for data owners
 */
export declare const getAttachmentReconciliationReport: (params?: GetAttachmentReconciliationReportParams, options?: RequestInit) => Promise<AttachmentReconciliationReport>;
export declare const getGetAttachmentReconciliationReportQueryKey: (params?: GetAttachmentReconciliationReportParams) => readonly ["/api/attachment-reconciliation/report", ...GetAttachmentReconciliationReportParams[]];
export declare const getGetAttachmentReconciliationReportQueryOptions: <TData = Awaited<ReturnType<typeof getAttachmentReconciliationReport>>, TError = ErrorType<unknown>>(params?: GetAttachmentReconciliationReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAttachmentReconciliationReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAttachmentReconciliationReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAttachmentReconciliationReportQueryResult = NonNullable<Awaited<ReturnType<typeof getAttachmentReconciliationReport>>>;
export type GetAttachmentReconciliationReportQueryError = ErrorType<unknown>;
/**
 * @summary Get aggregate reconciliation evidence for data owners
 */
export declare function useGetAttachmentReconciliationReport<TData = Awaited<ReturnType<typeof getAttachmentReconciliationReport>>, TError = ErrorType<unknown>>(params?: GetAttachmentReconciliationReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAttachmentReconciliationReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetLegacyStorageEvidenceInventoryUrl: (params?: GetLegacyStorageEvidenceInventoryParams) => string;
/**
 * Restricted administrator baseline. It reports source evidence, every rendered file surface, and aggregate canonical-record classifications without exposing object keys, external provider identifiers, or credentials.

 * @summary Get the redacted legacy storage dependency and attachment-surface inventory
 */
export declare const getLegacyStorageEvidenceInventory: (params?: GetLegacyStorageEvidenceInventoryParams, options?: RequestInit) => Promise<LegacyStorageEvidenceInventory>;
export declare const getGetLegacyStorageEvidenceInventoryQueryKey: (params?: GetLegacyStorageEvidenceInventoryParams) => readonly ["/api/attachment-reconciliation/inventory", ...GetLegacyStorageEvidenceInventoryParams[]];
export declare const getGetLegacyStorageEvidenceInventoryQueryOptions: <TData = Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>, TError = ErrorType<unknown>>(params?: GetLegacyStorageEvidenceInventoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetLegacyStorageEvidenceInventoryQueryResult = NonNullable<Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>>;
export type GetLegacyStorageEvidenceInventoryQueryError = ErrorType<unknown>;
/**
 * @summary Get the redacted legacy storage dependency and attachment-surface inventory
 */
export declare function useGetLegacyStorageEvidenceInventory<TData = Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>, TError = ErrorType<unknown>>(params?: GetLegacyStorageEvidenceInventoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLegacyStorageEvidenceInventory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDispositionAttachmentReconciliationEntryUrl: (id: number) => string;
/**
 * @summary Record an authorised owner disposition for an unresolved entry
 */
export declare const dispositionAttachmentReconciliationEntry: (id: number, attachmentReconciliationDispositionInput: AttachmentReconciliationDispositionInput, options?: RequestInit) => Promise<AttachmentReconciliationActionResult>;
export declare const getDispositionAttachmentReconciliationEntryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof dispositionAttachmentReconciliationEntry>>, TError, {
        id: number;
        data: BodyType<AttachmentReconciliationDispositionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof dispositionAttachmentReconciliationEntry>>, TError, {
    id: number;
    data: BodyType<AttachmentReconciliationDispositionInput>;
}, TContext>;
export type DispositionAttachmentReconciliationEntryMutationResult = NonNullable<Awaited<ReturnType<typeof dispositionAttachmentReconciliationEntry>>>;
export type DispositionAttachmentReconciliationEntryMutationBody = BodyType<AttachmentReconciliationDispositionInput>;
export type DispositionAttachmentReconciliationEntryMutationError = ErrorType<unknown>;
/**
 * @summary Record an authorised owner disposition for an unresolved entry
 */
export declare const useDispositionAttachmentReconciliationEntry: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof dispositionAttachmentReconciliationEntry>>, TError, {
        id: number;
        data: BodyType<AttachmentReconciliationDispositionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof dispositionAttachmentReconciliationEntry>>, TError, {
    id: number;
    data: BodyType<AttachmentReconciliationDispositionInput>;
}, TContext>;
export declare const getRecoverAttachmentReconciliationEntryUrl: (id: number) => string;
/**
 * @summary Recover an entry only after exact provider metadata verification
 */
export declare const recoverAttachmentReconciliationEntry: (id: number, attachmentReconciliationRecoveryInput: AttachmentReconciliationRecoveryInput, options?: RequestInit) => Promise<AttachmentReconciliationActionResult>;
export declare const getRecoverAttachmentReconciliationEntryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof recoverAttachmentReconciliationEntry>>, TError, {
        id: number;
        data: BodyType<AttachmentReconciliationRecoveryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof recoverAttachmentReconciliationEntry>>, TError, {
    id: number;
    data: BodyType<AttachmentReconciliationRecoveryInput>;
}, TContext>;
export type RecoverAttachmentReconciliationEntryMutationResult = NonNullable<Awaited<ReturnType<typeof recoverAttachmentReconciliationEntry>>>;
export type RecoverAttachmentReconciliationEntryMutationBody = BodyType<AttachmentReconciliationRecoveryInput>;
export type RecoverAttachmentReconciliationEntryMutationError = ErrorType<unknown>;
/**
 * @summary Recover an entry only after exact provider metadata verification
 */
export declare const useRecoverAttachmentReconciliationEntry: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof recoverAttachmentReconciliationEntry>>, TError, {
        id: number;
        data: BodyType<AttachmentReconciliationRecoveryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof recoverAttachmentReconciliationEntry>>, TError, {
    id: number;
    data: BodyType<AttachmentReconciliationRecoveryInput>;
}, TContext>;
export declare const getListPlansUrl: (params?: ListPlansParams) => string;
/**
 * @summary List plans with filters
 */
export declare const listPlans: (params?: ListPlansParams, options?: RequestInit) => Promise<PlanSummary[]>;
export declare const getListPlansQueryKey: (params?: ListPlansParams) => readonly ["/api/plans", ...ListPlansParams[]];
export declare const getListPlansQueryOptions: <TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(params?: ListPlansParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPlansQueryResult = NonNullable<Awaited<ReturnType<typeof listPlans>>>;
export type ListPlansQueryError = ErrorType<unknown>;
/**
 * @summary List plans with filters
 */
export declare function useListPlans<TData = Awaited<ReturnType<typeof listPlans>>, TError = ErrorType<unknown>>(params?: ListPlansParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPlans>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePlanUrl: () => string;
/**
 * @summary Create a new plan
 */
export declare const createPlan: (planInput: PlanInput, options?: RequestInit) => Promise<PlanDetail>;
export declare const getCreatePlanMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPlan>>, TError, {
        data: BodyType<PlanInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPlan>>, TError, {
    data: BodyType<PlanInput>;
}, TContext>;
export type CreatePlanMutationResult = NonNullable<Awaited<ReturnType<typeof createPlan>>>;
export type CreatePlanMutationBody = BodyType<PlanInput>;
export type CreatePlanMutationError = ErrorType<unknown>;
/**
 * @summary Create a new plan
 */
export declare const useCreatePlan: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPlan>>, TError, {
        data: BodyType<PlanInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPlan>>, TError, {
    data: BodyType<PlanInput>;
}, TContext>;
export declare const getGetPlanUrl: (planId: number) => string;
export declare const getPlan: (planId: number, options?: RequestInit) => Promise<PlanDetail>;
export declare const getGetPlanQueryKey: (planId: number) => readonly [`/api/plans/${number}`];
export declare const getGetPlanQueryOptions: <TData = Awaited<ReturnType<typeof getPlan>>, TError = ErrorType<unknown>>(planId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlan>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPlan>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPlanQueryResult = NonNullable<Awaited<ReturnType<typeof getPlan>>>;
export type GetPlanQueryError = ErrorType<unknown>;
export declare function useGetPlan<TData = Awaited<ReturnType<typeof getPlan>>, TError = ErrorType<unknown>>(planId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlan>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdatePlanUrl: (planId: number) => string;
export declare const updatePlan: (planId: number, planInput: PlanInput, options?: RequestInit) => Promise<PlanDetail>;
export declare const getUpdatePlanMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePlan>>, TError, {
        planId: number;
        data: BodyType<PlanInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePlan>>, TError, {
    planId: number;
    data: BodyType<PlanInput>;
}, TContext>;
export type UpdatePlanMutationResult = NonNullable<Awaited<ReturnType<typeof updatePlan>>>;
export type UpdatePlanMutationBody = BodyType<PlanInput>;
export type UpdatePlanMutationError = ErrorType<unknown>;
export declare const useUpdatePlan: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePlan>>, TError, {
        planId: number;
        data: BodyType<PlanInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePlan>>, TError, {
    planId: number;
    data: BodyType<PlanInput>;
}, TContext>;
export declare const getDeletePlanUrl: (planId: number) => string;
export declare const deletePlan: (planId: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePlanMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePlan>>, TError, {
        planId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePlan>>, TError, {
    planId: number;
}, TContext>;
export type DeletePlanMutationResult = NonNullable<Awaited<ReturnType<typeof deletePlan>>>;
export type DeletePlanMutationError = ErrorType<unknown>;
export declare const useDeletePlan: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePlan>>, TError, {
        planId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePlan>>, TError, {
    planId: number;
}, TContext>;
export declare const getTransitionPlanUrl: (planId: number) => string;
export declare const transitionPlan: (planId: number, workflowTransitionInput: WorkflowTransitionInput, options?: RequestInit) => Promise<PlanDetail>;
export declare const getTransitionPlanMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionPlan>>, TError, {
        planId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof transitionPlan>>, TError, {
    planId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export type TransitionPlanMutationResult = NonNullable<Awaited<ReturnType<typeof transitionPlan>>>;
export type TransitionPlanMutationBody = BodyType<WorkflowTransitionInput>;
export type TransitionPlanMutationError = ErrorType<unknown>;
export declare const useTransitionPlan: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof transitionPlan>>, TError, {
        planId: number;
        data: BodyType<WorkflowTransitionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof transitionPlan>>, TError, {
    planId: number;
    data: BodyType<WorkflowTransitionInput>;
}, TContext>;
export declare const getReopenPlanUrl: (planId: number) => string;
/**
 * @summary Reopen an approved plan for editing
 */
export declare const reopenPlan: (planId: number, reopenPlanBody: ReopenPlanBody, options?: RequestInit) => Promise<PlanDetail>;
export declare const getReopenPlanMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reopenPlan>>, TError, {
        planId: number;
        data: BodyType<ReopenPlanBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reopenPlan>>, TError, {
    planId: number;
    data: BodyType<ReopenPlanBody>;
}, TContext>;
export type ReopenPlanMutationResult = NonNullable<Awaited<ReturnType<typeof reopenPlan>>>;
export type ReopenPlanMutationBody = BodyType<ReopenPlanBody>;
export type ReopenPlanMutationError = ErrorType<unknown>;
/**
 * @summary Reopen an approved plan for editing
 */
export declare const useReopenPlan: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reopenPlan>>, TError, {
        planId: number;
        data: BodyType<ReopenPlanBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reopenPlan>>, TError, {
    planId: number;
    data: BodyType<ReopenPlanBody>;
}, TContext>;
export declare const getGetPlanningDashboardUrl: () => string;
export declare const getPlanningDashboard: (options?: RequestInit) => Promise<PlanningDashboard>;
export declare const getGetPlanningDashboardQueryKey: () => readonly ["/api/plans/dashboard"];
export declare const getGetPlanningDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getPlanningDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlanningDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPlanningDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPlanningDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getPlanningDashboard>>>;
export type GetPlanningDashboardQueryError = ErrorType<unknown>;
export declare function useGetPlanningDashboard<TData = Awaited<ReturnType<typeof getPlanningDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPlanningDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetConversationsUnreadCountUrl: () => string;
export declare const getConversationsUnreadCount: (options?: RequestInit) => Promise<GetConversationsUnreadCount200>;
export declare const getGetConversationsUnreadCountQueryKey: () => readonly ["/api/conversations/unread-count"];
export declare const getGetConversationsUnreadCountQueryOptions: <TData = Awaited<ReturnType<typeof getConversationsUnreadCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversationsUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getConversationsUnreadCount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetConversationsUnreadCountQueryResult = NonNullable<Awaited<ReturnType<typeof getConversationsUnreadCount>>>;
export type GetConversationsUnreadCountQueryError = ErrorType<unknown>;
export declare function useGetConversationsUnreadCount<TData = Awaited<ReturnType<typeof getConversationsUnreadCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversationsUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListConversationsUrl: (params?: ListConversationsParams) => string;
export declare const listConversations: (params?: ListConversationsParams, options?: RequestInit) => Promise<ConversationListPage>;
export declare const getListConversationsQueryKey: (params?: ListConversationsParams) => readonly ["/api/conversations", ...ListConversationsParams[]];
export declare const getListConversationsQueryOptions: <TData = Awaited<ReturnType<typeof listConversations>>, TError = ErrorType<unknown>>(params?: ListConversationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListConversationsQueryResult = NonNullable<Awaited<ReturnType<typeof listConversations>>>;
export type ListConversationsQueryError = ErrorType<unknown>;
export declare function useListConversations<TData = Awaited<ReturnType<typeof listConversations>>, TError = ErrorType<unknown>>(params?: ListConversationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConversations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateConversationUrl: () => string;
export declare const createConversation: (conversationInput: ConversationInput, options?: RequestInit) => Promise<ConversationSummary>;
export declare const getCreateConversationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createConversation>>, TError, {
        data: BodyType<ConversationInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createConversation>>, TError, {
    data: BodyType<ConversationInput>;
}, TContext>;
export type CreateConversationMutationResult = NonNullable<Awaited<ReturnType<typeof createConversation>>>;
export type CreateConversationMutationBody = BodyType<ConversationInput>;
export type CreateConversationMutationError = ErrorType<unknown>;
export declare const useCreateConversation: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createConversation>>, TError, {
        data: BodyType<ConversationInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createConversation>>, TError, {
    data: BodyType<ConversationInput>;
}, TContext>;
export declare const getGetConversationUrl: (conversationId: number) => string;
export declare const getConversation: (conversationId: number, options?: RequestInit) => Promise<Conversation>;
export declare const getGetConversationQueryKey: (conversationId: number) => readonly [`/api/conversations/${number}`];
export declare const getGetConversationQueryOptions: <TData = Awaited<ReturnType<typeof getConversation>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getConversation>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetConversationQueryResult = NonNullable<Awaited<ReturnType<typeof getConversation>>>;
export type GetConversationQueryError = ErrorType<unknown>;
export declare function useGetConversation<TData = Awaited<ReturnType<typeof getConversation>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getMarkConversationReadUrl: (conversationId: number) => string;
export declare const markConversationRead: (conversationId: number, options?: RequestInit) => Promise<void>;
export declare const getMarkConversationReadMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markConversationRead>>, TError, {
        conversationId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof markConversationRead>>, TError, {
    conversationId: number;
}, TContext>;
export type MarkConversationReadMutationResult = NonNullable<Awaited<ReturnType<typeof markConversationRead>>>;
export type MarkConversationReadMutationError = ErrorType<unknown>;
export declare const useMarkConversationRead: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markConversationRead>>, TError, {
        conversationId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof markConversationRead>>, TError, {
    conversationId: number;
}, TContext>;
export declare const getAddConversationMemberUrl: (conversationId: number) => string;
export declare const addConversationMember: (conversationId: number, conversationMemberInput: ConversationMemberInput, options?: RequestInit) => Promise<void>;
export declare const getAddConversationMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addConversationMember>>, TError, {
        conversationId: number;
        data: BodyType<ConversationMemberInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addConversationMember>>, TError, {
    conversationId: number;
    data: BodyType<ConversationMemberInput>;
}, TContext>;
export type AddConversationMemberMutationResult = NonNullable<Awaited<ReturnType<typeof addConversationMember>>>;
export type AddConversationMemberMutationBody = BodyType<ConversationMemberInput>;
export type AddConversationMemberMutationError = ErrorType<unknown>;
export declare const useAddConversationMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addConversationMember>>, TError, {
        conversationId: number;
        data: BodyType<ConversationMemberInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addConversationMember>>, TError, {
    conversationId: number;
    data: BodyType<ConversationMemberInput>;
}, TContext>;
export declare const getListConversationMessagesUrl: (conversationId: number, params?: ListConversationMessagesParams) => string;
export declare const listConversationMessages: (conversationId: number, params?: ListConversationMessagesParams, options?: RequestInit) => Promise<MessageHistoryPage>;
export declare const getListConversationMessagesQueryKey: (conversationId: number, params?: ListConversationMessagesParams) => readonly [`/api/conversations/${number}/messages`, ...ListConversationMessagesParams[]];
export declare const getListConversationMessagesQueryOptions: <TData = Awaited<ReturnType<typeof listConversationMessages>>, TError = ErrorType<unknown>>(conversationId: number, params?: ListConversationMessagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConversationMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listConversationMessages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListConversationMessagesQueryResult = NonNullable<Awaited<ReturnType<typeof listConversationMessages>>>;
export type ListConversationMessagesQueryError = ErrorType<unknown>;
export declare function useListConversationMessages<TData = Awaited<ReturnType<typeof listConversationMessages>>, TError = ErrorType<unknown>>(conversationId: number, params?: ListConversationMessagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listConversationMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSendMessageUrl: (conversationId: number) => string;
export declare const sendMessage: (conversationId: number, messageInput: MessageInput, options?: RequestInit) => Promise<Message>;
export declare const getSendMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendMessage>>, TError, {
        conversationId: number;
        data: BodyType<MessageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendMessage>>, TError, {
    conversationId: number;
    data: BodyType<MessageInput>;
}, TContext>;
export type SendMessageMutationResult = NonNullable<Awaited<ReturnType<typeof sendMessage>>>;
export type SendMessageMutationBody = BodyType<MessageInput>;
export type SendMessageMutationError = ErrorType<unknown>;
export declare const useSendMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendMessage>>, TError, {
        conversationId: number;
        data: BodyType<MessageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendMessage>>, TError, {
    conversationId: number;
    data: BodyType<MessageInput>;
}, TContext>;
export declare const getListPinnedMessagesUrl: (conversationId: number) => string;
export declare const listPinnedMessages: (conversationId: number, options?: RequestInit) => Promise<Message[]>;
export declare const getListPinnedMessagesQueryKey: (conversationId: number) => readonly [`/api/conversations/${number}/pinned`];
export declare const getListPinnedMessagesQueryOptions: <TData = Awaited<ReturnType<typeof listPinnedMessages>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPinnedMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPinnedMessages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPinnedMessagesQueryResult = NonNullable<Awaited<ReturnType<typeof listPinnedMessages>>>;
export type ListPinnedMessagesQueryError = ErrorType<unknown>;
export declare function useListPinnedMessages<TData = Awaited<ReturnType<typeof listPinnedMessages>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPinnedMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetConversationMediaUrl: (conversationId: number) => string;
export declare const getConversationMedia: (conversationId: number, options?: RequestInit) => Promise<ConversationMedia>;
export declare const getGetConversationMediaQueryKey: (conversationId: number) => readonly [`/api/conversations/${number}/media`];
export declare const getGetConversationMediaQueryOptions: <TData = Awaited<ReturnType<typeof getConversationMedia>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversationMedia>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getConversationMedia>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetConversationMediaQueryResult = NonNullable<Awaited<ReturnType<typeof getConversationMedia>>>;
export type GetConversationMediaQueryError = ErrorType<unknown>;
export declare function useGetConversationMedia<TData = Awaited<ReturnType<typeof getConversationMedia>>, TError = ErrorType<unknown>>(conversationId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getConversationMedia>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetMessageAttachmentUrl: (conversationId: number, messageId: number, index: number) => string;
export declare const getMessageAttachment: (conversationId: number, messageId: number, index: number, options?: RequestInit) => Promise<Blob>;
export declare const getGetMessageAttachmentQueryKey: (conversationId: number, messageId: number, index: number) => readonly [`/api/conversations/${number}/messages/${number}/attachments/${number}`];
export declare const getGetMessageAttachmentQueryOptions: <TData = Awaited<ReturnType<typeof getMessageAttachment>>, TError = ErrorType<unknown>>(conversationId: number, messageId: number, index: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMessageAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMessageAttachment>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMessageAttachmentQueryResult = NonNullable<Awaited<ReturnType<typeof getMessageAttachment>>>;
export type GetMessageAttachmentQueryError = ErrorType<unknown>;
export declare function useGetMessageAttachment<TData = Awaited<ReturnType<typeof getMessageAttachment>>, TError = ErrorType<unknown>>(conversationId: number, messageId: number, index: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMessageAttachment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getEditMessageUrl: (messageId: number) => string;
export declare const editMessage: (messageId: number, messageEditInput: MessageEditInput, options?: RequestInit) => Promise<Message>;
export declare const getEditMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof editMessage>>, TError, {
        messageId: number;
        data: BodyType<MessageEditInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof editMessage>>, TError, {
    messageId: number;
    data: BodyType<MessageEditInput>;
}, TContext>;
export type EditMessageMutationResult = NonNullable<Awaited<ReturnType<typeof editMessage>>>;
export type EditMessageMutationBody = BodyType<MessageEditInput>;
export type EditMessageMutationError = ErrorType<unknown>;
export declare const useEditMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof editMessage>>, TError, {
        messageId: number;
        data: BodyType<MessageEditInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof editMessage>>, TError, {
    messageId: number;
    data: BodyType<MessageEditInput>;
}, TContext>;
export declare const getDeleteMessageUrl: (messageId: number) => string;
export declare const deleteMessage: (messageId: number, messageDeleteInput?: MessageDeleteInput, options?: RequestInit) => Promise<void>;
export declare const getDeleteMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteMessage>>, TError, {
        messageId: number;
        data?: BodyType<MessageDeleteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteMessage>>, TError, {
    messageId: number;
    data?: BodyType<MessageDeleteInput>;
}, TContext>;
export type DeleteMessageMutationResult = NonNullable<Awaited<ReturnType<typeof deleteMessage>>>;
export type DeleteMessageMutationBody = BodyType<MessageDeleteInput> | undefined;
export type DeleteMessageMutationError = ErrorType<unknown>;
export declare const useDeleteMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteMessage>>, TError, {
        messageId: number;
        data?: BodyType<MessageDeleteInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteMessage>>, TError, {
    messageId: number;
    data?: BodyType<MessageDeleteInput>;
}, TContext>;
export declare const getToggleMessageReactionUrl: (messageId: number) => string;
export declare const toggleMessageReaction: (messageId: number, reactionInput: ReactionInput, options?: RequestInit) => Promise<Reaction[]>;
export declare const getToggleMessageReactionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof toggleMessageReaction>>, TError, {
        messageId: number;
        data: BodyType<ReactionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof toggleMessageReaction>>, TError, {
    messageId: number;
    data: BodyType<ReactionInput>;
}, TContext>;
export type ToggleMessageReactionMutationResult = NonNullable<Awaited<ReturnType<typeof toggleMessageReaction>>>;
export type ToggleMessageReactionMutationBody = BodyType<ReactionInput>;
export type ToggleMessageReactionMutationError = ErrorType<unknown>;
export declare const useToggleMessageReaction: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof toggleMessageReaction>>, TError, {
        messageId: number;
        data: BodyType<ReactionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof toggleMessageReaction>>, TError, {
    messageId: number;
    data: BodyType<ReactionInput>;
}, TContext>;
export declare const getPinMessageUrl: (messageId: number) => string;
export declare const pinMessage: (messageId: number, options?: RequestInit) => Promise<void>;
export declare const getPinMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof pinMessage>>, TError, {
        messageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof pinMessage>>, TError, {
    messageId: number;
}, TContext>;
export type PinMessageMutationResult = NonNullable<Awaited<ReturnType<typeof pinMessage>>>;
export type PinMessageMutationError = ErrorType<unknown>;
export declare const usePinMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof pinMessage>>, TError, {
        messageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof pinMessage>>, TError, {
    messageId: number;
}, TContext>;
export declare const getUnpinMessageUrl: (messageId: number) => string;
export declare const unpinMessage: (messageId: number, options?: RequestInit) => Promise<void>;
export declare const getUnpinMessageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof unpinMessage>>, TError, {
        messageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof unpinMessage>>, TError, {
    messageId: number;
}, TContext>;
export type UnpinMessageMutationResult = NonNullable<Awaited<ReturnType<typeof unpinMessage>>>;
export type UnpinMessageMutationError = ErrorType<unknown>;
export declare const useUnpinMessage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof unpinMessage>>, TError, {
        messageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof unpinMessage>>, TError, {
    messageId: number;
}, TContext>;
export declare const getRemoveConversationMemberUrl: (conversationId: number, memberId: number) => string;
export declare const removeConversationMember: (conversationId: number, memberId: number, options?: RequestInit) => Promise<void>;
export declare const getRemoveConversationMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeConversationMember>>, TError, {
        conversationId: number;
        memberId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof removeConversationMember>>, TError, {
    conversationId: number;
    memberId: number;
}, TContext>;
export type RemoveConversationMemberMutationResult = NonNullable<Awaited<ReturnType<typeof removeConversationMember>>>;
export type RemoveConversationMemberMutationError = ErrorType<unknown>;
export declare const useRemoveConversationMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeConversationMember>>, TError, {
        conversationId: number;
        memberId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof removeConversationMember>>, TError, {
    conversationId: number;
    memberId: number;
}, TContext>;
export declare const getListAuditLogUrl: (params?: ListAuditLogParams) => string;
export declare const listAuditLog: (params?: ListAuditLogParams, options?: RequestInit) => Promise<AuditLogPage>;
export declare const getListAuditLogQueryKey: (params?: ListAuditLogParams) => readonly ["/api/audit-log", ...ListAuditLogParams[]];
export declare const getListAuditLogQueryOptions: <TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<ListAuditLog400>>(params?: ListAuditLogParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAuditLogQueryResult = NonNullable<Awaited<ReturnType<typeof listAuditLog>>>;
export type ListAuditLogQueryError = ErrorType<ListAuditLog400>;
export declare function useListAuditLog<TData = Awaited<ReturnType<typeof listAuditLog>>, TError = ErrorType<ListAuditLog400>>(params?: ListAuditLogParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAuditLog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map