import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, logAudit, type Variables } from "../lib/rbac";
import {
  canEdit,
  canEditContent,
  getManualLocale,
  parseManualSteps,
  runManualImportPreflight,
  ManualPreflightBlockedError,
  ensureLocalizedCorpus,
  ensureSeeded,
  ensureTerminologyMigrated,
  ensureKCSetup,
  markLocalizationsStale,
  chapterSelect,
} from "../lib/manual";
import { MANUAL_ARABIC_DRAFT, MANUAL_SOP_STEP_ARABIC_DRAFT } from "../lib/manual-arabic-draft";
import { ARABIC_CHAPTERS, MACHINE_DRAFT_GAPS } from "../lib/manual-seed-data";
import { manualSourceChecksum } from "../lib/manual-localization-checksum";

/**
 * Ported from artifacts/api-server/src/routes/manual.ts (3149 lines — the
 * seed-data constants were mechanically extracted into lib/manual-seed-data.ts
 * rather than retyped; lib/manual-arabic-draft.ts and
 * lib/manual-localization-checksum.ts were copied verbatim; the remaining
 * logic helpers live in lib/manual.ts). This file holds only the actual HTTP
 * routes.
 *
 * Every route here sits behind global auth in api-server (routes/index.ts's
 * router.use(requireAuth) before router.use(manualRouter)) even though most
 * individual routes carry no explicit requirePerm — mirrored here by mounting
 * attachCurrentUser + requireAuth on every /manual/* path.
 */

export const manualRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

manualRoutes.use("/manual", attachCurrentUser, requireAuth);
manualRoutes.use("/manual/*", attachCurrentUser, requireAuth);

// GET /manual/search?q=   — searches sections, FAQs, and SOPs
manualRoutes.get("/manual/search", async (c) => {
  const { db, pool, close } = openDb(c);
  try {
    await ensureSeeded(db, pool);
    const locale = getManualLocale(c.req.query("locale"));
    const q = (c.req.query("q") ?? "").trim();
    if (!q || q.length < 2) return c.json([]);
    const like = `%${q}%`;
    // Sections (primary)
    const { rows: sectionRows } = await db.query<Record<string, unknown>>(
      `SELECT mc.id, mc.slug,
              CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS "chapterTitle",
              CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END AS "sectionTitle",
              LEFT(CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END, 200) AS "excerpt",
              'section' AS "resultType"
       FROM manual_sections ms
       JOIN manual_chapters mc ON mc.id = ms.chapter_id
       LEFT JOIN manual_chapter_localizations mcl ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
       LEFT JOIN manual_section_localizations msl ON msl.section_id = ms.id AND msl.locale = '${locale}'
       WHERE mc.status = 'published'
         AND (CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END ILIKE $1
           OR CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END ILIKE $1
           OR CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END ILIKE $1)
       ORDER BY mc."order", ms."order"
       LIMIT 20`,
      [like],
    );
    // FAQs
    const faqResult = await db.query<Record<string, unknown>>(
      `SELECT mf.id, 'faq' AS slug,
              CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END AS "chapterTitle",
              CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END AS "sectionTitle",
              LEFT(CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END, 200) AS "excerpt",
              'faq' AS "resultType"
       FROM manual_faqs mf
       LEFT JOIN manual_faq_localizations mfl ON mfl.faq_id = mf.id AND mfl.locale = '${locale}'
       WHERE mf.status = 'published'
         AND (CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END ILIKE $1
           OR CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END ILIKE $1)
       ORDER BY mf.category, mf."order"
       LIMIT 10`,
      [like],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    // SOPs
    const sopResult = await db.query<Record<string, unknown>>(
      `SELECT mso.id, mc.slug,
              CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS "chapterTitle",
              CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END AS "sectionTitle",
              LEFT(CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END, 200) AS "excerpt",
              'sop' AS "resultType"
       FROM manual_sops mso
       JOIN manual_chapters mc ON mc.id = mso.chapter_id
       LEFT JOIN manual_chapter_localizations mcl ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
       LEFT JOIN manual_sop_localizations msol ON msol.sop_id = mso.id AND msol.locale = '${locale}'
       WHERE mc.status = 'published'
         AND (CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END ILIKE $1
           OR CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END ILIKE $1)
       ORDER BY mc."order", mso."order"
       LIMIT 10`,
      [like],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    return c.json([...sectionRows, ...faqResult.rows, ...sopResult.rows].slice(0, 30));
  } finally {
    close();
  }
});

// GET /manual/chapters
manualRoutes.get("/manual/chapters", async (c) => {
  const user = c.get("currentUser");
  const { db, pool, close } = openDb(c);
  try {
    await ensureSeeded(db, pool);
    await ensureTerminologyMigrated(db);
    const locale = getManualLocale(c.req.query("locale"));
    const showAll = canEdit(user);
    const { rows } = await db.query(
      `${chapterSelect(locale)}
       ${showAll ? "" : "WHERE mc.status = 'published'"}
       ORDER BY mc."order"`,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

// POST /manual/chapters
manualRoutes.post("/manual/chapters", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
    const { title, slug, description, icon, order, language, status } = body;
    if (!title?.trim() || !slug?.trim()) {
      return c.json({ error: "title and slug are required" }, 400);
    }
    let id: number;
    try {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO manual_chapters (title, slug, description, icon, "order", language, status, created_by_id, updated_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [title.trim(), slug.trim(), description ?? null, icon ?? "FileText", order ?? 999, language ?? "en", status ?? "draft", user.id],
      );
      id = rows[0].id;
    } catch (err) {
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === "23505" && pg.constraint === "manual_chapters_slug_unique") {
        return c.json({ error: "slug_taken" }, 409);
      }
      throw err;
    }
    await logAudit(db, { userId: user.id, action: "create", module: "manual_chapter", entityId: id, newValue: JSON.stringify({ title, slug }) });
    const { rows: ch } = await db.query(`${chapterSelect()} WHERE mc.id = $1`, [id]);
    return c.json(ch[0], 201);
  } finally {
    close();
  }
});

// POST /manual/chapters/reorder  (must be before /:slug)
manualRoutes.post("/manual/chapters/reorder", requirePerm("manual.edit"), async (c) => {
  const { pool, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { orderedIds?: number[] };
    const orderedIds = body.orderedIds;
    if (!Array.isArray(orderedIds)) {
      return c.json({ error: "orderedIds array required" }, 400);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query(`UPDATE manual_chapters SET "order" = $1 WHERE id = $2`, [i + 1, orderedIds[i]]);
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// GET /manual/chapters/:slug
manualRoutes.get("/manual/chapters/:slug", async (c) => {
  const user = c.get("currentUser");
  const { db, pool, close } = openDb(c);
  try {
    await ensureSeeded(db, pool);
    await ensureTerminologyMigrated(db);
    const slug = c.req.param("slug");
    const locale = getManualLocale(c.req.query("locale"));
    const showAll = canEdit(user);
    const { rows: ch } = await db.query<Record<string, unknown>>(
      `${chapterSelect(locale)} WHERE mc.slug = $1 ${showAll ? "" : "AND mc.status = 'published'"}`,
      [slug],
    );
    if (!ch.length) return c.json({ error: "not_found" }, 404);
    const chapter = ch[0];
    const { rows: sections } = await db.query(
      `SELECT ms.id, ms.chapter_id AS "chapterId",
              CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END AS title,
              CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END AS content,
              ms."order", ms.created_at AS "createdAt", ms.updated_at AS "updatedAt"
       FROM manual_sections ms
       LEFT JOIN manual_section_localizations msl ON msl.section_id = ms.id AND msl.locale = '${locale}'
       WHERE ms.chapter_id = $1 ORDER BY ms."order"`,
      [chapter.id],
    );
    const { rows: sops } = await db.query(
      `SELECT mso.id, mso.chapter_id AS "chapterId",
              CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END AS "processName",
              CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END AS purpose,
              CASE WHEN '${locale}' = 'ar' THEN msol.responsible_role ELSE mso.responsible_role END AS "responsibleRole",
              CASE WHEN '${locale}' = 'ar' THEN msol.steps ELSE mso.steps END AS steps,
              CASE WHEN '${locale}' = 'ar' THEN msol.required_inputs ELSE mso.required_inputs END AS "requiredInputs",
              CASE WHEN '${locale}' = 'ar' THEN msol.approval_flow ELSE mso.approval_flow END AS "approvalFlow",
              CASE WHEN '${locale}' = 'ar' THEN msol.outputs ELSE mso.outputs END AS outputs,
              CASE WHEN '${locale}' = 'ar' THEN msol.timeline ELSE mso.timeline END AS timeline,
              CASE WHEN '${locale}' = 'ar' THEN msol.related_module ELSE mso.related_module END AS "relatedModule",
              CASE WHEN '${locale}' = 'ar' THEN msol.notifications ELSE mso.notifications END AS notifications,
              mso."order"
       FROM manual_sops mso
       LEFT JOIN manual_sop_localizations msol ON msol.sop_id = mso.id AND msol.locale = '${locale}'
       WHERE mso.chapter_id = $1 ORDER BY mso."order"`,
      [chapter.id],
    );
    return c.json({ ...chapter, sections, sops });
  } finally {
    close();
  }
});

// PATCH /manual/chapters/:slug
manualRoutes.patch("/manual/chapters/:slug", requirePerm("manual.edit.content"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const slug = c.req.param("slug");
    const { rows: existing } = await db.query<{ id: number }>(
      "SELECT id FROM manual_chapters WHERE slug = $1",
      [slug],
    );
    if (!existing.length) return c.json({ error: "not_found" }, 404);
    const chapterId = existing[0].id;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
    const { title, description, icon, order, language, status } = body;
    if (title !== undefined && !title.trim()) {
      return c.json({ error: "invalid_title" }, 400);
    }
    await db.query(
      `UPDATE manual_chapters
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           icon = COALESCE($3, icon),
           "order" = COALESCE($4, "order"),
           language = COALESCE($5, language),
           status = COALESCE($6, status),
           updated_by_id = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [title?.trim() ?? null, description ?? null, icon ?? null, order ?? null, language ?? null, status ?? null, user.id, chapterId],
    );
    if (title !== undefined || description !== undefined) {
      await markLocalizationsStale(db, "manual_chapter_localizations", "chapter_id", chapterId);
    }
    await logAudit(db, { userId: user.id, action: "update", module: "manual_chapter", entityId: chapterId });
    const { rows: ch } = await db.query(`${chapterSelect()} WHERE mc.id = $1`, [chapterId]);
    return c.json(ch[0]);
  } finally {
    close();
  }
});

// DELETE /manual/chapters/:id — by numeric ID, not slug: a slug is caller-
// supplied text, and even with the slug now unique, deleting by the row's
// own stable primary key is the precise, unambiguous target. Cascades to
// every dependent row (sections, SOPs, their localizations, and version
// history) since none of those carry a DB-level ON DELETE CASCADE.
manualRoutes.delete("/manual/chapters/:id", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { pool, close } = openDb(c);
  try {
    const chapterId = Number(c.req.param("id"));
    if (!Number.isInteger(chapterId) || chapterId < 1) {
      return c.json({ error: "invalid_chapter_id" }, 400);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: number }>(
        "SELECT id FROM manual_chapters WHERE id = $1 FOR UPDATE",
        [chapterId],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return c.json({ error: "not_found" }, 404);
      }
      await client.query(
        `DELETE FROM manual_sop_localizations WHERE sop_id IN (SELECT id FROM manual_sops WHERE chapter_id = $1)`,
        [chapterId],
      );
      await client.query(`DELETE FROM manual_sops WHERE chapter_id = $1`, [chapterId]);
      await client.query(
        `DELETE FROM manual_section_localizations WHERE section_id IN (SELECT id FROM manual_sections WHERE chapter_id = $1)`,
        [chapterId],
      );
      await client.query(`DELETE FROM manual_sections WHERE chapter_id = $1`, [chapterId]);
      await client.query(`DELETE FROM manual_chapter_localizations WHERE chapter_id = $1`, [chapterId]);
      await client.query(`DELETE FROM manual_version_history WHERE chapter_id = $1`, [chapterId]);
      await client.query(`DELETE FROM manual_chapters WHERE id = $1`, [chapterId]);
      await logAudit(client, { userId: user.id, action: "delete", module: "manual_chapter", entityId: chapterId });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return c.json({ ok: true });
  } finally {
    close();
  }
});

/* ── Sections ──────────────────────────────────────────────────────── */

manualRoutes.post("/manual/chapters/:slug/sections", requirePerm("manual.edit.content"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const slug = c.req.param("slug");
    const { rows: ch } = await db.query<{ id: number }>(
      "SELECT id FROM manual_chapters WHERE slug = $1",
      [slug],
    );
    if (!ch.length) return c.json({ error: "not_found" }, 404);
    const chapterId = ch[0].id;
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; content?: string; order?: number };
    const { title, content, order } = body;
    if (!title?.trim()) return c.json({ error: "title required" }, 400);
    const { rows: maxOrder } = await db.query<{ m: number }>(
      `SELECT COALESCE(MAX("order"), 0) AS m FROM manual_sections WHERE chapter_id = $1`,
      [chapterId],
    );
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO manual_sections (chapter_id, title, content, "order") VALUES ($1,$2,$3,$4) RETURNING id`,
      [chapterId, title.trim(), content ?? "", order ?? maxOrder[0].m + 1],
    );
    await logAudit(db, { userId: user.id, action: "create", module: "manual_section", entityId: rows[0].id });
    const { rows: sec } = await db.query(
      `SELECT id, chapter_id AS "chapterId", title, content, "order", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM manual_sections WHERE id = $1`,
      [rows[0].id],
    );
    return c.json(sec[0], 201);
  } finally {
    close();
  }
});

manualRoutes.patch("/manual/sections/:id", requirePerm("manual.edit.content"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const { rows: old } = await db.query<{ content: string; chapter_id: number }>(
      "SELECT content, chapter_id FROM manual_sections WHERE id = $1",
      [id],
    );
    if (!old.length) return c.json({ error: "not_found" }, 404);
    await db.query(
      `INSERT INTO manual_version_history (chapter_id, section_id, previous_content, updated_by_id)
       VALUES ($1,$2,$3,$4)`,
      [old[0].chapter_id, id, old[0].content, user.id],
    );
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; content?: string; order?: number };
    const { title, content, order } = body;
    if (title !== undefined && !title.trim()) return c.json({ error: "invalid_title" }, 400);
    await db.query(
      `UPDATE manual_sections
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           "order" = COALESCE($3, "order"),
           updated_at = NOW()
       WHERE id = $4`,
      [title?.trim() ?? null, content ?? null, order ?? null, id],
    );
    if (title !== undefined || content !== undefined) {
      await markLocalizationsStale(db, "manual_section_localizations", "section_id", id);
    }
    await logAudit(db, { userId: user.id, action: "update", module: "manual_section", entityId: id });
    const { rows } = await db.query(
      `SELECT id, chapter_id AS "chapterId", title, content, "order", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM manual_sections WHERE id = $1`,
      [id],
    );
    return c.json(rows[0]);
  } finally {
    close();
  }
});

manualRoutes.delete("/manual/sections/:id", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const { rows } = await db.query("DELETE FROM manual_sections WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    await logAudit(db, { userId: user.id, action: "delete", module: "manual_section", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

/* ── SOPs ─────────────────────────────────────────────────────────── */

manualRoutes.post("/manual/chapters/:slug/sops", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const slug = c.req.param("slug");
    const { rows: ch } = await db.query<{ id: number }>(
      "SELECT id FROM manual_chapters WHERE slug = $1",
      [slug],
    );
    if (!ch.length) return c.json({ error: "not_found" }, 404);
    const chapterId = ch[0].id;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications, order } = body;
    if (typeof processName !== "string" || !processName.trim()) {
      return c.json({ error: "processName required" }, 400);
    }
    const { rows: maxOrder } = await db.query<{ m: number }>(
      `SELECT COALESCE(MAX("order"), 0) AS m FROM manual_sops WHERE chapter_id = $1`,
      [chapterId],
    );
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO manual_sops
       (chapter_id, process_name, purpose, responsible_role, steps, required_inputs,
        approval_flow, outputs, timeline, related_module, notifications, "order")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [chapterId, processName.trim(), purpose ?? null, responsibleRole ?? null, steps ? JSON.stringify(steps) : null,
       requiredInputs ?? null, approvalFlow ?? null, outputs ?? null, timeline ?? null,
       relatedModule ?? null, notifications ?? null, order ?? (maxOrder[0].m as number) + 1],
    );
    await logAudit(db, { userId: user.id, action: "create", module: "manual_sop", entityId: rows[0].id });
    const { rows: sop } = await db.query(
      `SELECT id, chapter_id AS "chapterId", process_name AS "processName", purpose,
              responsible_role AS "responsibleRole", steps, required_inputs AS "requiredInputs",
              approval_flow AS "approvalFlow", outputs, timeline, related_module AS "relatedModule",
              notifications, "order" FROM manual_sops WHERE id = $1`,
      [rows[0].id],
    );
    return c.json(sop[0], 201);
  } finally {
    close();
  }
});

manualRoutes.patch("/manual/sops/:id", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const { rows: old } = await db.query("SELECT id FROM manual_sops WHERE id = $1", [id]);
    if (!old.length) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications } = body;
    if (processName !== undefined && (typeof processName !== "string" || !processName.trim())) {
      return c.json({ error: "invalid_process_name" }, 400);
    }
    await db.query(
      `UPDATE manual_sops SET
       process_name = COALESCE($1, process_name),
       purpose = COALESCE($2, purpose),
       responsible_role = COALESCE($3, responsible_role),
       steps = COALESCE($4, steps),
       required_inputs = COALESCE($5, required_inputs),
       approval_flow = COALESCE($6, approval_flow),
       outputs = COALESCE($7, outputs),
       timeline = COALESCE($8, timeline),
       related_module = COALESCE($9, related_module),
       notifications = COALESCE($10, notifications),
       updated_at = NOW()
       WHERE id = $11`,
      [typeof processName === "string" ? processName.trim() : null, purpose ?? null, responsibleRole ?? null, steps ? JSON.stringify(steps) : null,
       requiredInputs ?? null, approvalFlow ?? null, outputs ?? null, timeline ?? null,
       relatedModule ?? null, notifications ?? null, id],
    );
    if ([processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications].some((v) => v !== undefined)) {
      await markLocalizationsStale(db, "manual_sop_localizations", "sop_id", id);
    }
    await logAudit(db, { userId: user.id, action: "update", module: "manual_sop", entityId: id });
    const { rows } = await db.query(
      `SELECT id, chapter_id AS "chapterId", process_name AS "processName", purpose,
              responsible_role AS "responsibleRole", steps, required_inputs AS "requiredInputs",
              approval_flow AS "approvalFlow", outputs, timeline, related_module AS "relatedModule",
              notifications, "order" FROM manual_sops WHERE id = $1`,
      [id],
    );
    return c.json(rows[0]);
  } finally {
    close();
  }
});

manualRoutes.delete("/manual/sops/:id", requirePerm("manual.edit"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const id = Number(c.req.param("id"));
    const { rows } = await db.query("DELETE FROM manual_sops WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    await logAudit(db, { userId: user.id, action: "delete", module: "manual_sop", entityId: id });
    return c.json({ ok: true });
  } finally {
    close();
  }
});

/* ── KC routes ───────────────────────────────────────────────────── */

// GET /manual/faqs
manualRoutes.get("/manual/faqs", async (c) => {
  const { db, pool, close } = openDb(c);
  try {
    await ensureKCSetup(db);
    await ensureSeeded(db, pool);
    const locale = getManualLocale(c.req.query("locale"));
    const { rows } = await db.query<{ id: number; question: string; answer: string; category: string; order: number }>(
      `SELECT mf.id,
              CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END AS question,
              CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END AS answer,
              CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END AS category,
              mf."order"
       FROM manual_faqs mf
       LEFT JOIN manual_faq_localizations mfl ON mfl.faq_id = mf.id AND mfl.locale = '${locale}'
       WHERE mf.status = 'published'
       ORDER BY CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END, mf."order"`,
    );
    const grouped: Record<string, { id: number; question: string; answer: string; order: number }[]> = {};
    for (const r of rows) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push({ id: r.id, question: r.question, answer: r.answer, order: r.order });
    }
    return c.json(grouped);
  } finally {
    close();
  }
});

// Editorial inventory used by regression checks. It deliberately reports
// missing records instead of substituting English source values for Arabic.
manualRoutes.get("/manual/localization-parity", async (c) => {
  const user = c.get("currentUser");
  const { db, pool, close } = openDb(c);
  try {
    if (!canEdit(user)) return c.json({ error: "forbidden" }, 403);
    await ensureSeeded(db, pool);
    const locale = getManualLocale(c.req.query("locale"));
    const checks = await Promise.all([
      db.query<{ total: string; missing: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.title) = '')::text AS missing
         FROM manual_chapters base
         LEFT JOIN manual_chapter_localizations l ON l.chapter_id = base.id AND l.locale = $1`,
        [locale],
      ),
      db.query<{ total: string; missing: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.title) = '' OR BTRIM(l.content) = '')::text AS missing
         FROM manual_sections base
         LEFT JOIN manual_section_localizations l ON l.section_id = base.id AND l.locale = $1`,
        [locale],
      ),
      db.query<{ total: string; missing: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.process_name) = '')::text AS missing
         FROM manual_sops base
         LEFT JOIN manual_sop_localizations l ON l.sop_id = base.id AND l.locale = $1`,
        [locale],
      ),
      db.query<{ total: string; missing: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.question) = '' OR BTRIM(l.answer) = '')::text AS missing
         FROM manual_faqs base
         LEFT JOIN manual_faq_localizations l ON l.faq_id = base.id AND l.locale = $1`,
        [locale],
      ),
    ]);
    const [chapters, sections, sops, faqs] = checks.map(({ rows }) => ({
      total: Number(rows[0].total),
      missing: Number(rows[0].missing),
    }));
    const missing = chapters.missing + sections.missing + sops.missing + faqs.missing;
    const [sourceRows, localizedRows] = await Promise.all([
      db.query<{ kind: string; id: number; source: unknown }>(`
        SELECT 'chapter' AS kind, id, jsonb_build_object('title', title, 'description', description) AS source FROM manual_chapters
        UNION ALL SELECT 'section', id, jsonb_build_object('title', title, 'content', content) FROM manual_sections
        UNION ALL SELECT 'sop', id, jsonb_build_object('process_name', process_name, 'purpose', purpose, 'responsible_role', responsible_role, 'steps', steps, 'required_inputs', required_inputs, 'approval_flow', approval_flow, 'outputs', outputs, 'timeline', timeline, 'related_module', related_module, 'notifications', notifications) FROM manual_sops
        UNION ALL SELECT 'faq', id, jsonb_build_object('question', question, 'answer', answer, 'category', category) FROM manual_faqs
      `),
      db.query<{ kind: string; source_id: number; source_checksum: string | null; translation_status: string }>(`
        SELECT 'chapter' AS kind, chapter_id AS source_id, source_checksum, translation_status FROM manual_chapter_localizations WHERE locale='ar'
        UNION ALL SELECT 'section', section_id, source_checksum, translation_status FROM manual_section_localizations WHERE locale='ar'
        UNION ALL SELECT 'sop', sop_id, source_checksum, translation_status FROM manual_sop_localizations WHERE locale='ar'
        UNION ALL SELECT 'faq', faq_id, source_checksum, translation_status FROM manual_faq_localizations WHERE locale='ar'
      `),
    ]);
    const localized = new Map(localizedRows.rows.map((row) => [`${row.kind}:${row.source_id}`, row]));
    const report = { inSync: 0, sourceChanged: 0, missingLocalizedRows: 0, missingMappings: 0, reviewed: 0, machineDraft: 0, orphaned: 0, invalid: 0, blockers: [] as Array<{ kind: string; id: number; state: string }> };
    for (const row of sourceRows.rows) {
      const key = `${row.kind}:${row.id}`;
      const loc = localized.get(key);
      const source = row.source as Record<string, unknown>;
      const fields = Object.entries(source).flatMap(([field, value]) => {
        if (field === "steps") {
          const parsed = parseManualSteps(value);
          return Array.isArray(parsed)
            ? parsed.flatMap((step) => step && typeof step === "object" ? Object.values(step) : [])
            : [];
        }
        return Array.isArray(value) ? value : [value];
      }).filter((value): value is string => typeof value === "string" && value.trim() !== "");
      const unmapped = locale === "ar" && fields.some((value) =>
        !MANUAL_ARABIC_DRAFT[value]
        && !MACHINE_DRAFT_GAPS[value]
        && !ARABIC_CHAPTERS[String(value)]
        && !(row.kind === "sop" && MANUAL_SOP_STEP_ARABIC_DRAFT[row.id]?.[value]),
      );
      if (unmapped) {
        report.missingMappings++;
        report.blockers.push({ kind: row.kind, id: row.id, state: "MISSING_TRANSLATION_MAPPING" });
      }
      if (!loc) {
        report.missingLocalizedRows++;
        report.blockers.push({ kind: row.kind, id: row.id, state: "MISSING_LOCALIZED_ROW" });
        continue;
      }
      if (loc.translation_status === "reviewed" || loc.translation_status === "approved") report.reviewed++;
      if (loc.translation_status === "draft_machine_generated") report.machineDraft++;
      if (loc.source_checksum === manualSourceChecksum(source)) report.inSync++;
      else {
        report.sourceChanged++;
        report.blockers.push({ kind: row.kind, id: row.id, state: "SOURCE_CHANGED" });
      }
    }
    const localKeys = new Set(sourceRows.rows.map((row) => `${row.kind}:${row.id}`));
    report.orphaned = localizedRows.rows.filter((row) => !localKeys.has(`${row.kind}:${row.source_id}`)).length;
    return c.json({ locale, chapters, sections, sops, faqs, missing, complete: missing === 0, totalSources: sourceRows.rows.length, localizableFields: sourceRows.rows.length, ...report, dryRun: true });
  } finally {
    close();
  }
});

// Explicit editorial write boundary. This imports the checked-in
// machine-generated draft once; it is never invoked by Manual GET/search
// routes and never overwrites a human-reviewed translation.
manualRoutes.post("/manual/localization/import-machine-draft", async (c) => {
  const user = c.get("currentUser");
  const { db, pool, close } = openDb(c);
  try {
    // Development permits the authenticated QA workflow to load the checked-in
    // draft. Production remains limited to the established Manual editors.
    if (c.env.NODE_ENV !== "development" && !canEdit(user)) {
      return c.json({ error: "forbidden" }, 403);
    }
    try {
      const preflight = await runManualImportPreflight(db);
      if (preflight.missingMappings > 0) {
        return c.json({ ok: false, state: "PRECHECK_BLOCKED", ...preflight }, 409);
      }
      await ensureSeeded(db, pool);
      await ensureKCSetup(db);
      await ensureLocalizedCorpus(pool);
    } catch (error) {
      if (error instanceof ManualPreflightBlockedError) {
        return c.json({ ok: false, state: "PRECHECK_BLOCKED", ...error.preflight }, 409);
      }
      return c.json({ ok: false, state: "TRANSACTION_FAILED", rolledBack: true }, 500);
    }
    return c.json({
      ok: true,
      status: "draft_machine_generated",
      reviewStatus: "review_required",
    });
  } finally {
    close();
  }
});

manualRoutes.patch("/manual/localizations/:kind/:id", requirePerm("manual.edit.content"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { status, reviewed, ...fields } = body;
    const nextStatus = status === "reviewed" || status === "approved" ? status : "review_required";
    const reviewedAt = reviewed === true || nextStatus === "reviewed" || nextStatus === "approved";
    const reviewer = reviewedAt ? user.id : null;
    const table = kind === "chapter" ? "manual_chapter_localizations"
      : kind === "section" ? "manual_section_localizations"
      : kind === "sop" ? "manual_sop_localizations"
      : kind === "faq" ? "manual_faq_localizations" : null;
    const key = kind === "chapter" ? "chapter_id" : kind === "section" ? "section_id" : kind === "sop" ? "sop_id" : "faq_id";
    if (!table || !Number.isInteger(Number(id)) || fields.locale !== "ar") {
      return c.json({ error: "kind, numeric id, and locale=ar are required" }, 400);
    }
    const allowed = ["title", "description", "content", "process_name", "purpose", "responsible_role", "steps", "required_inputs", "approval_flow", "outputs", "timeline", "related_module", "notifications", "question", "answer", "category"];
    const assignments = Object.keys(fields).filter((name) => allowed.includes(name)).map((name, index) => `"${name}" = $${index + 1}`);
    const values = Object.keys(fields).filter((name) => allowed.includes(name)).map((name) => fields[name]);
    if (!assignments.length) {
      return c.json({ error: "at least one localized field is required" }, 400);
    }
    values.push(nextStatus, reviewer);
    const statusParam = values.length - 1;
    const reviewerParam = values.length;
    await db.query(
      `UPDATE ${table} SET ${assignments.join(", ")}, translation_status=$${statusParam},
         reviewed_at=${reviewedAt ? "NOW()" : "NULL"}, reviewed_by_id=$${reviewerParam}, updated_at=NOW()
       WHERE ${key}=$${values.length + 1} AND locale='ar'`,
      [...values, Number(id)],
    );
    return c.json({ ok: true, status: nextStatus, reviewRequired: nextStatus !== "approved" && nextStatus !== "reviewed" });
  } finally {
    close();
  }
});

// GET /manual/popular
manualRoutes.get("/manual/popular", async (c) => {
  const { db, close } = openDb(c);
  try {
    await ensureKCSetup(db);
    const { rows } = await db.query(
      `SELECT mc.id, mc.title, mc.slug, mc.description, mc.icon, mc."order", mc.status,
              COALESCE(mc.view_count, 0) AS "viewCount",
              mc.updated_at AS "updatedAt",
              (SELECT COUNT(*)::int FROM manual_sections ms WHERE ms.chapter_id = mc.id) AS "sectionCount",
              (SELECT COUNT(*)::int FROM manual_sops mso WHERE mso.chapter_id = mc.id) AS "sopCount"
       FROM manual_chapters mc
       WHERE mc.status = 'published'
       ORDER BY COALESCE(mc.view_count, 0) DESC, mc."order"
       LIMIT 6`,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

// POST /manual/chapters/:slug/view  (increment view counter)
manualRoutes.post("/manual/chapters/:slug/view", async (c) => {
  const { db, close } = openDb(c);
  try {
    await ensureKCSetup(db);
    await db.query(
      `UPDATE manual_chapters SET view_count = COALESCE(view_count, 0) + 1 WHERE slug = $1`,
      [c.req.param("slug")],
    );
    return c.json({ ok: true });
  } finally {
    close();
  }
});

// POST /manual/chapters/:slug/feedback
manualRoutes.post("/manual/chapters/:slug/feedback", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    await ensureKCSetup(db);
    const slug = c.req.param("slug");
    const body = (await c.req.json().catch(() => ({}))) as { helpful?: unknown };
    const { helpful } = body;
    if (typeof helpful !== "boolean") {
      return c.json({ error: "helpful (boolean) required" }, 400);
    }
    await db.query(
      `INSERT INTO manual_feedback (chapter_slug, user_id, helpful) VALUES ($1,$2,$3)`,
      [slug, user?.id ?? null, helpful],
    );
    const { rows } = await db.query<{ helpful: boolean; count: string }>(
      `SELECT helpful, COUNT(*) AS count FROM manual_feedback WHERE chapter_slug = $1 GROUP BY helpful`,
      [slug],
    );
    const stats = { helpful: 0, notHelpful: 0 };
    for (const r of rows) {
      if (r.helpful) stats.helpful = Number(r.count);
      else stats.notHelpful = Number(r.count);
    }
    return c.json({ ok: true, stats });
  } finally {
    close();
  }
});

// GET /manual/chapters/:slug/feedback  (get feedback stats for a chapter)
manualRoutes.get("/manual/chapters/:slug/feedback", async (c) => {
  const { db, close } = openDb(c);
  try {
    await ensureKCSetup(db);
    const slug = c.req.param("slug");
    const { rows } = await db.query<{ helpful: boolean; count: string }>(
      `SELECT helpful, COUNT(*) AS count FROM manual_feedback WHERE chapter_slug = $1 GROUP BY helpful`,
      [slug],
    );
    const stats = { helpful: 0, notHelpful: 0 };
    for (const r of rows) {
      if (r.helpful) stats.helpful = Number(r.count);
      else stats.notHelpful = Number(r.count);
    }
    return c.json(stats);
  } finally {
    close();
  }
});
