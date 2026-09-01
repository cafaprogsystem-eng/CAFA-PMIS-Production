import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";

const router: IRouter = Router();

// Whether AI is enabled at the environment level.
// Set AI_ENABLED=true in production once OpenAI integration is provisioned.
// Defaults to false (UAT / pre-launch mode).
const AI_ENV_ENABLED = process.env.AI_ENABLED === "true";

// Lazy-load the OpenAI client — only attempted when AI_ENV_ENABLED=true.
// This prevents server startup failures when the integration env vars are absent.
async function getOpenAIClient() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

// ── Knowledge base (built-in system context) ─────────────────────────────────
const CAFA_KNOWLEDGE = `
CAFA PMIS — SYSTEM KNOWLEDGE BASE

ORGANIZATION: CAFA Development Organization (منظمة كافا للتنمية), Sudan operations.
MISSION: Humanitarian project management across the canonical 18-State Sudan registry.

MODULES:
1. Dashboard — Live KPIs: project counts, beneficiary totals, budget burn, pending approvals, risk heat-map, state performance, sector performance, recent activity.
2. Projects — Full project lifecycle. Fields: title, code (CAFA-{STATE_CODE}-NNN), sector, donor, states/localities, budget, outputs, activities, indicators, beneficiaries (IDP/returnee/host community/refugee, M/F/B/G), documents. Status workflow below.
3. Reports — Monthly / Quarterly / Annual / Ad-hoc narrative reports. Sections: objectives, progress narrative, activities implemented (repeater), challenges, budget actual vs planned. 5-stage approval workflow.
4. Plans — 6 types: monthly, quarterly, annual, action, operational, emergency. Linked to projects or standalone. Activities with risk links. 9-stage workflow.
5. Risks — Operational / Security / Financial / Programmatic / Environmental. Severity × Likelihood heat-map. Linked to projects and plans. Mitigations tracked.
6. Budget — Org-wide financial tracking. Donor allocations, output budgets, burn rate. HQ only.
7. States — 15 Sudan states + localities. Per-state KPIs, project counts, beneficiary breakdown.
8. Users — Staff directory. Roles, status (active/invited/suspended), state/sector assignment. Super admin only for writes.
9. Messages — Internal WhatsApp-style communication. Direct, group, project-linked, state-linked, sector-linked conversations.
10. System Manual — SOPs, user guides, workflow instructions. 20 chapters auto-seeded.
11. File Storage — CAFA-managed attachment storage. Module-organized files. Upload, version, archive.
12. Planning Dashboard — Cross-plan KPIs, Gantt view, late activities, completion rates.
13. Notifications — In-app inbox for workflow transitions, comments, document uploads.
14. Audit Log — Full before/after diff for every data change.

APPROVAL WORKFLOWS:
Projects: draft → submitted → technically_approved → coordination_approved → approved → active → closed
  Chain: State Officer submits → Technical Coordinator reviews → Senior Coordinator coordinates → Program Manager approves → activate → close
Reports: draft → submitted → coordination_approved → approved (→ archived)
  Chain: SPO/TC creates → Senior Coordinator coordinates → Program Manager approves
Plans: draft → submitted → technically_approved → coordination_approved → approved → active → in_progress → completed / delayed (→ archived)
  Transitions can also go: reject, request_revision, cancel

SECTORS (7 canonical Main Sectors): Health, Nutrition, WASH, Education, Protection, Food Security & Livelihoods (FSL), Shelter & NFI
SUB-SECTORS: Health→[General Health, Primary Healthcare, Maternal & Child Health, MHPSS]; Nutrition→[Acute Malnutrition Treatment, Chronic Malnutrition Prevention, IYCF]; WASH→[Water Supply, Sanitation, Hygiene Promotion]; Education→[Primary, Secondary, ECD, Vocational Training]; Protection→[Child Protection, GBV, Mine Action, Legal Aid]; FSL→[Food Assistance, Livelihoods, Agriculture, Cash & Voucher Assistance]; Shelter & NFI→[Emergency Shelter, NFI Distribution, Transitional Shelter, Permanent Housing]
ASSISTANCE_MODALITIES: Cash, Voucher, In-Kind, Service Delivery, Multipurpose Cash Assistance (MPCA), Mixed Modality
NOTE: MPCA and Agriculture & Livelihoods are no longer Main Sectors. Legacy MPCA data uses assistance_modality=Multipurpose Cash Assistance (MPCA). Legacy Child Protection/GBV records migrated to Protection with respective sub-sectors.

ROLES & WHAT THEY CAN DO:
- super_admin: Full access to everything including user management, system settings, AI logs
- executive_director: Read-all, view users, view budget, view risks, approve nothing (oversight only)
- program_manager: Final approver (projects, reports, plans), create/edit everything HQ-level, view users
- senior_program_coordinator: Coordination approver, create/edit projects/plans/risks, view all budgets, edit manual
- technical_coordinator: Technical approver (sector-scoped), create reports and plans, sector-restricted data
- state_office_manager: Read-only monitoring for assigned state (no writes, no comments)
- state_program_officer: Creates projects, reports, risks, plans for assigned state; submits for approval

DOCUMENT UPLOAD: Use "Upload" button on project detail page under Documents tab. Supports PDF, Word, Excel, images up to 50MB. Files are served through CAFA-managed attachment storage; do not expose provider paths to users.

EXPORT: Reports page has "Export CSV" button. Project detail has "Export PDF" (print dialog). Manual chapters have Print + Word export buttons.

BENEFICIARY TRACKING: Registered per project in the project form. Categories: IDP, Returnee, Host Community, Refugee. Breakdown: Male, Female, Boys, Girls. Dashboard shows aggregated totals with modal breakdown.

DEMO CREDENTIALS: password cafa2026 for all users. Username is email local-part (e.g. amira for super_admin).
`;

// ── Role context builder ──────────────────────────────────────────────────────
function buildRoleContext(user: {
  role: string;
  roleLabel: string;
  stateName?: string | null;
  sector?: string | null;
  sectors?: string[] | null;
}): string {
  const lines: string[] = [];
  switch (user.role) {
    case "super_admin":
      lines.push("You have FULL access to all data, settings, and users. You can perform any action in the system.");
      break;
    case "executive_director":
      lines.push("You have READ-ONLY access to all projects, reports, risks, plans, and users across all states and sectors.");
      lines.push("You do NOT approve projects or reports — that is the Program Manager's role.");
      break;
    case "program_manager":
      lines.push("You are the FINAL APPROVER for projects, reports, and plans.");
      lines.push("You can create, edit, and close all projects and reports across all states and sectors.");
      lines.push("You can view all user accounts and manage the system manual.");
      break;
    case "senior_program_coordinator":
      lines.push("You are the COORDINATION REVIEWER — you approve projects and reports at the coordination stage.");
      lines.push("You can create and edit projects, plans, and risks. You can view all budgets.");
      lines.push("You can edit System Manual content.");
      break;
    case "technical_coordinator":
      lines.push(`You are a TECHNICAL REVIEWER with sector restriction: ${user.sector ?? "not assigned"}.`);
      lines.push("You can only access projects, reports, and risks in your assigned sector(s).");
      lines.push("You can create reports and plans. You review and technically approve projects.");
      break;
    case "state_office_manager":
      lines.push(`You are a STATE MANAGER for ${user.stateName ?? "your assigned state"} — MONITORING ONLY.`);
      lines.push("You can VIEW projects, reports, risks, and budgets for your state but CANNOT create, edit, or approve anything.");
      lines.push("You do NOT have access to the comments or messages system.");
      break;
    case "state_program_officer":
      lines.push(`You are a STATE PROGRAM OFFICER for ${user.stateName ?? "your assigned state"}.`);
      lines.push("You CREATE projects, reports, risks, and plans for your state and submit them for HQ review.");
      lines.push("You can upload documents and track activities and beneficiaries.");
      break;
    default:
      lines.push(`Your role is ${user.roleLabel}. Follow standard system guidelines.`);
  }
  return lines.join("\n");
}

// ── System prompt factory ─────────────────────────────────────────────────────
function buildSystemPrompt(opts: {
  user: { name: string; role: string; roleLabel: string; stateName?: string | null; sector?: string | null; sectors?: string[] | null };
  currentPage: string;
  lang: string;
  extraPrompt?: string | null;
}): string {
  const { user, currentPage, lang, extraPrompt } = opts;
  const langInstr = lang === "ar"
    ? "LANGUAGE: Respond in Arabic (العربية). Use RTL-appropriate formatting."
    : lang === "en"
    ? "LANGUAGE: Respond in English."
    : "LANGUAGE: Match the language the user writes in (Arabic or English). Default to English.";

  return `You are CAFA AI Assistant — an internal system assistant for the CAFA Development Organization (منظمة كافا للتنمية) Program Management Information System (PMIS) for Sudan humanitarian operations.

You help authenticated staff understand and use the system. You are professional, concise, and helpful. You know every module, workflow, and permission rule.

CURRENT USER:
- Name: ${user.name}
- Role: ${user.roleLabel} (${user.role})
- State: ${user.stateName ?? "HQ / All States"}
- Sector: ${user.sector ?? "All Sectors"}

CURRENT PAGE: ${currentPage}

USER'S ACCESS LEVEL:
${buildRoleContext(user)}

SECURITY RULES (NEVER violate):
1. Only answer about data the user is permitted to access based on their role above.
2. Do NOT reveal information about users, budgets, projects, or reports outside the user's access scope.
3. For state_program_officer and state_office_manager: restrict answers to their assigned state only.
4. For technical_coordinator: restrict to their assigned sector only.
5. For sensitive actions (delete, approve, submit, export): always remind the user to confirm in the UI.
6. NEVER make up data or invent project names, figures, or user names.

${langInstr}

${CAFA_KNOWLEDGE}

${extraPrompt ? `\nADDITIONAL INSTRUCTIONS FROM ADMIN:\n${extraPrompt}` : ""}

PAGE CONTEXT HELP:
- If the user is on Dashboard (/): explain KPI cards, pending approvals, beneficiary breakdown modal, state/sector charts.
- If on Projects (/projects or /projects/:id): help with registration form, approval steps, document uploads, activities/indicators.
- If on Reports (/reports/*): help with report sections, activity repeater, beneficiary entry, submission workflow, export.
- If on Plans (/plans/* or /planning-dashboard): explain plan types, activity linking, risk association, workflow stages.
- If on Risks (/risks): help with risk matrix, severity/likelihood ratings, mitigation entries, project linking.
- If on Budget (/budget): explain donor allocation, burn rate, output-level budget tracking.
- If on Users (/users): guide on creating users, invite flow, role assignment, status actions.
- If on Messages (/messages): explain conversation types (direct/group/project/state/sector), reply, file attachment.
- If on Manual (/manual/*): guide on chapters, SOPs, search, PDF/Word export.
- If on File Storage (/drive): explain folder structure, upload, versioning, archive.

Be concise. Use bullet points for steps. For navigation, name the exact page and sidebar path.`;
}

// ── GET /ai/settings ──────────────────────────────────────────────────────────
router.get("/ai/settings", async (req, res, next) => {
  try {
    // Always read the DB singleton so the admin settings page can reflect and
    // save the configured state even when AI_ENABLED env flag is not yet set.
    // Clients use the separate `envEnabled` field to know whether AI is
    // actually operational (env flag) vs. administratively configured (DB).
    const { rows } = await pool.query(`SELECT * FROM ai_settings WHERE id = 1`);
    const row = rows[0];
    res.json({
      enabled: row?.enabled ?? "true",
      envEnabled: AI_ENV_ENABLED,
      ...(AI_ENV_ENABLED ? {} : { reason: "uat_mode" }),
      systemPromptExtra: row?.system_prompt_extra ?? null,
      responseLanguage: row?.response_language ?? "auto",
      ...(row ? { updatedAt: row.updated_at } : {}),
    });
  } catch (err) { next(err); }
});

// ── PUT /ai/settings (super_admin / executive_director only) ──────────────────
router.put("/ai/settings", requirePerm("ai.settings.manage"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const { enabled, systemPromptExtra, responseLanguage } = req.body ?? {};
    const params = [enabled ?? "true", systemPromptExtra ?? null, responseLanguage ?? "auto", user.id];

    // UPDATE only — never INSERT during a normal save/enable/disable. This is
    // safe because the singleton row (id=1) is guaranteed to exist after the
    // one-time migration. INSERT is used only as a last-resort fallback if the
    // row is somehow absent (e.g. fresh empty DB), avoiding any conflict with
    // the production unique index ai_settings_singleton_idx.
    const { rowCount } = await pool.query(
      `UPDATE ai_settings
       SET enabled            = $1,
           system_prompt_extra = $2,
           response_language  = $3,
           updated_at         = NOW(),
           updated_by         = $4
       WHERE id = 1`,
      params,
    );

    if ((rowCount ?? 0) === 0) {
      // Fallback: table is empty (fresh DB) — seed the singleton row.
      await pool.query(
        `INSERT INTO ai_settings (id, enabled, system_prompt_extra, response_language, updated_at, updated_by)
         VALUES (1, $1, $2, $3, NOW(), $4)`,
        params,
      );
    }

    await logAudit({ userId: user.id, action: "ai_settings_updated", module: "ai", entityId: null });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /ai/history — user's own chat history ─────────────────────────────────
router.get("/ai/history", async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const { sessionId, limit = "50" } = req.query as Record<string, string>;
    const params: unknown[] = [user.id];
    let where = "user_id = $1";
    if (sessionId) {
      params.push(sessionId);
      where += ` AND session_id = $${params.length}`;
    }
    params.push(Number(limit));
    const { rows } = await pool.query(
      `SELECT id, session_id AS "sessionId", role, content, module,
              status, prompt_tokens AS "promptTokens", completion_tokens AS "completionTokens",
              created_at AS "createdAt"
       FROM ai_chat_messages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ messages: rows });
  } catch (err) { next(err); }
});

// ── GET /ai/logs — admin: all sessions with full usage detail ─────────────────
router.get("/ai/logs", requirePerm("ai.logs.view"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const { limit = "200", offset = "0", search } = req.query as Record<string, string>;
    const params: unknown[] = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE LOWER(m.content) LIKE LOWER($${params.length}) OR LOWER(u.name) LIKE LOWER($${params.length})`;
    }
    params.push(Number(limit), Number(offset));
    const { rows } = await pool.query(
      `SELECT m.id, m.session_id AS "sessionId", m.role, m.content, m.module,
              m.user_role AS "userRole", m.status,
              m.prompt_tokens AS "promptTokens",
              m.completion_tokens AS "completionTokens",
              m.created_at AS "createdAt",
              u.id AS "userId", u.name AS "userName", u.role AS "userRoleDb"
       FROM ai_chat_messages m
       JOIN users u ON u.id = m.user_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ai_chat_messages m JOIN users u ON u.id = m.user_id ${where}`,
      params.slice(0, params.length - 2),
    );
    res.json({ messages: rows, total: countRows[0]?.total ?? 0 });
  } catch (err) { next(err); }
});

// ── DELETE /ai/history — clear own chat history ───────────────────────────────
router.delete("/ai/history", async (req, res, next) => {
  try {
    const user = req.currentUser!;
    await pool.query(`DELETE FROM ai_chat_messages WHERE user_id = $1`, [user.id]);
    await logAudit({ userId: user.id, action: "delete_history", module: "ai", entityId: user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ai/chat — streaming SSE chat ───────────────────────────────────────
router.post("/ai/chat", async (req, res, next) => {
  try {
    const user = req.currentUser!;

    // Guard 1: environment-level flag
    if (!AI_ENV_ENABLED) {
      res.status(503).json({
        error: "ai_disabled",
        reason: "uat_mode",
        message: "AI Assistant is currently disabled for UAT. It is ready to be activated after live deployment.",
      });
      return;
    }

    // Guard 2: admin DB toggle — always read the singleton row id=1
    const { rows: settingsRows } = await pool.query(`SELECT * FROM ai_settings WHERE id = 1`);
    const settings = settingsRows[0];
    if (settings?.enabled === "false") {
      res.status(503).json({ error: "ai_disabled", message: "The AI assistant is currently disabled by the administrator." });
      return;
    }

    const { message, currentPage, sessionId: clientSessionId, lang } = req.body ?? {};
    if (!message?.trim()) { res.status(400).json({ error: "message_required" }); return; }

    const sessionId = clientSessionId ?? crypto.randomUUID();
    const currentModule = String(currentPage ?? "/").slice(0, 120);
    const responseLang = lang ?? settings?.response_language ?? "auto";

    // Fetch recent session history for context (last 20 messages)
    const { rows: historyRows } = await pool.query(
      `SELECT role, content FROM ai_chat_messages
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at ASC LIMIT 20`,
      [user.id, sessionId],
    );

    // Save user message
    await pool.query(
      `INSERT INTO ai_chat_messages (user_id, session_id, role, content, module, user_role, status)
       VALUES ($1, $2, 'user', $3, $4, $5, 'success')`,
      [user.id, sessionId, message.trim(), currentModule, user.role],
    );

    const systemPrompt = buildSystemPrompt({
      user: {
        name: user.name,
        role: user.role,
        roleLabel: user.roleLabel,
        stateName: user.stateName,
        sector: user.sector,
        sectors: user.sectors,
      },
      currentPage: currentModule,
      lang: responseLang,
      extraPrompt: settings?.system_prompt_extra,
    });

    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...historyRows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content })),
      { role: "user", content: message.trim() },
    ];

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let fullResponse = "";
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let assistantStatus: "success" | "failed" = "success";

    try {
      const openai = await getOpenAIClient();
      const stream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 2048,
        messages: chatMessages,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        // Capture token usage from the final usage chunk
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? null;
          completionTokens = chunk.usage.completion_tokens ?? null;
        }
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } catch (openaiErr) {
      assistantStatus = "failed";
      const errMsg = (openaiErr as Error)?.message ?? "AI service error";
      fullResponse = `_Error: ${errMsg}_`;
      res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
    }

    // Persist assistant response with usage stats
    await pool.query(
      `INSERT INTO ai_chat_messages
         (user_id, session_id, role, content, module, user_role, status, prompt_tokens, completion_tokens)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8)`,
      [user.id, sessionId, fullResponse, currentModule, user.role, assistantStatus, promptTokens, completionTokens],
    );

    res.write(`data: ${JSON.stringify({ done: true, sessionId })}\n\n`);
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "stream_error" })}\n\n`);
      res.end();
    } else {
      next(err);
    }
  }
});

export default router;
