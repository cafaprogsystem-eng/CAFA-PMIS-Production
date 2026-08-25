import { Router, type IRouter } from "express";
import { attachCurrentUser, requireAuth } from "../middlewares/currentUser";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { offlineRevisionMiddleware } from "../middlewares/offline-revision";
import authRouter from "./auth";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import statesRouter from "./states";
import projectsRouter from "./projects";
import beneficiariesRouter from "./beneficiaries";
import risksRouter from "./risks";
import reportsRouter from "./reports";
import dashboardRouter from "./dashboard";
import auditRouter from "./audit";
import storageRouter from "./storage";
import commentsRouter from "./comments";
import notificationsRouter from "./notifications";
import plansRouter from "./plans";
import conversationsRouter from "./conversations";
import manualRouter from "./manual";
import trainingVideosRouter from "./training-videos";
import passwordResetAdminRouter from "./password-reset-admin";
import profileRouter from "./profile";
import aiRouter from "./ai";
import realtimeRouter from "./realtime";
import voiceNotesRouter from "./voice-notes";
import programResourcesRouter from "./program-resources";
import filesRouter from "./files";
import searchRouter from "./search";
import auditReportViewerRouter from "./audit-report-viewer";
import attachmentReconciliationRouter from "./attachment-reconciliation";
import historicalStorageImportRouter from "./historical-storage-import";
import attachmentsRouter from "./attachments";

const router: IRouter = Router();

router.use(attachCurrentUser);

// Public routes (login, health) — no auth required.
router.use(authRouter);
router.use(healthRouter);
// Temporary internal audit viewer — no auth required (read-only, dev-only file)
router.use(auditReportViewerRouter);

// Everything below requires a current user. The development identity header is
// ignored unless the explicitly enabled non-production demo harness accepts it.
// requireAuth must come BEFORE idempotencyMiddleware so that unauthenticated
// callers cannot receive replayed responses without a valid session.
router.use(requireAuth);

// Idempotency key check — prevents duplicate records when the offline sync
// queue replays mutations that were already processed successfully.
// Runs after auth so replay is gated on a valid session.
router.use(idempotencyMiddleware);
router.use(offlineRevisionMiddleware);

router.use(meRouter);
router.use(usersRouter);
router.use(statesRouter);
router.use(projectsRouter);
router.use(beneficiariesRouter);
router.use(risksRouter);
router.use(reportsRouter);
router.use(dashboardRouter);
router.use(auditRouter);
router.use(storageRouter);
router.use(attachmentsRouter);
router.use(commentsRouter);
router.use(notificationsRouter);
router.use(plansRouter);
router.use(conversationsRouter);
router.use(manualRouter);
router.use(trainingVideosRouter);
router.use(passwordResetAdminRouter);
router.use(profileRouter);
router.use(aiRouter);
router.use(realtimeRouter);
router.use(voiceNotesRouter);
router.use(programResourcesRouter);
router.use(filesRouter);
router.use(searchRouter);
router.use(attachmentReconciliationRouter);
router.use(historicalStorageImportRouter);

export default router;
