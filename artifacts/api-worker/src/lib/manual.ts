import type { Pool } from "pg";
import type { QueryExecutor } from "./db";
import type { CurrentUser } from "./rbac";
import { MANUAL_ARABIC_DRAFT, MANUAL_SOP_STEP_ARABIC_DRAFT } from "./manual-arabic-draft";
import { legacyManualSourceChecksums, manualSourceChecksum } from "./manual-localization-checksum";
import { INITIAL_CHAPTERS, ARABIC_CHAPTERS, MACHINE_DRAFT_GAPS, FAQ_SEED } from "./manual-seed-data";

/**
 * Ported from artifacts/api-server/src/routes/manual.ts's non-route helpers
 * (ensureSeeded, ensureTerminologyMigrated, ensureLocalizedCorpus,
 * ensureKCSetup/seedFAQs, markLocalizationsStale, the arabicManualText/
 * translateManualSteps localization helpers, and chapterSelect). Kept in a
 * separate lib module from routes/manual.ts given the file's overall size.
 *
 * The module-level `seeded`/`terminologyMigrated`/`kcSetupDone` flags are the
 * same soft, non-durable cache the source relies on: a long-lived Node
 * process there, a Workers isolate reused across many requests here. Neither
 * guarantees the check never re-runs (a process restart; an isolate
 * eviction), and neither needs to — the underlying operations are all
 * idempotent (COUNT-gated or ON CONFLICT).
 */

export function canEdit(user: CurrentUser | undefined): boolean {
  return !!user && ["super_admin", "program_manager"].includes(user.role);
}

export function canEditContent(user: CurrentUser | undefined): boolean {
  return !!user && ["super_admin", "program_manager", "senior_program_coordinator"].includes(user.role);
}

export type ManualLocale = "en" | "ar";

export function getManualLocale(rawLocale: unknown): ManualLocale {
  return String(rawLocale ?? "en").toLowerCase() === "ar" ? "ar" : "en";
}

function arabicManualText(value: string | null | undefined): string {
  if (!value) return "";
  const directTranslation = MANUAL_ARABIC_DRAFT[value] ?? MACHINE_DRAFT_GAPS[value];
  if (directTranslation) return directTranslation;
  // The canonical seed keeps rich Manual bodies as a single field, while the
  // approved machine-draft corpus also records several of those bodies as
  // individually translated paragraph blocks. Recompose only when *every*
  // source block has an exact stored Arabic counterpart; never substitute
  // English or generate content during a request.
  const blocks = value.split(/\n\n+/);
  const composed = blocks.length > 1
    ? blocks.map((block) => MANUAL_ARABIC_DRAFT[block] ?? MACHINE_DRAFT_GAPS[block]).filter(Boolean)
    : [];
  const translation = composed.length === blocks.length ? composed.join("\n\n") : undefined;
  if (!translation) throw new Error(`Missing machine Arabic draft for Manual source: ${value.slice(0, 80)}`);
  return translation;
}

export function parseManualSteps(value: unknown): unknown {
  let parsed = value;
  for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt++) {
    try {
      const next = JSON.parse(parsed);
      if (!next || typeof next !== "object") return parsed;
      parsed = next;
    } catch {
      return parsed;
    }
  }
  return parsed;
}

function translateManualSteps(value: unknown, sopId?: number): unknown {
  const parsed = parseManualSteps(value);
  if (!Array.isArray(parsed)) return parsed;
  const structuredMappings = sopId ? MANUAL_SOP_STEP_ARABIC_DRAFT[sopId] : undefined;
  return parsed.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return step;
    return Object.fromEntries(
      Object.entries(step).map(([key, item]) => [
        key,
        typeof item === "string" && item.trim()
          ? structuredMappings?.[item] ?? arabicManualText(item)
          : item,
      ]),
    );
  });
}

export type ManualPreflight = {
  totalLocalizableFields: number;
  matchedMappings: number;
  missingMappings: number;
  blockers: Array<{ kind: string; id: number; field: string; state: "MISSING_TRANSLATION_MAPPING" }>;
};

export async function runManualImportPreflight(db: QueryExecutor): Promise<ManualPreflight> {
  const { rows } = await db.query<{ kind: string; id: number; source: Record<string, unknown> }>(`
    SELECT 'chapter' AS kind, id,
      jsonb_build_object('title', title, 'description', description) AS source
      FROM manual_chapters
    UNION ALL SELECT 'section', id,
      jsonb_build_object('title', title, 'content', content)
      FROM manual_sections
    UNION ALL SELECT 'sop', id,
      jsonb_build_object('process_name', process_name, 'purpose', purpose,
        'responsible_role', responsible_role, 'steps', steps,
        'required_inputs', required_inputs, 'approval_flow', approval_flow,
        'outputs', outputs, 'timeline', timeline, 'related_module', related_module,
        'notifications', notifications)
      FROM manual_sops
    UNION ALL SELECT 'faq', id,
      jsonb_build_object('question', question, 'answer', answer, 'category', category)
      FROM manual_faqs
  `);
  const blockers: ManualPreflight["blockers"] = [];
  let totalLocalizableFields = 0;
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.source)) {
      const values = field === "steps" ? [parseManualSteps(value)] : (Array.isArray(value) ? value : [value]);
      for (const item of values) {
        const items = field === "steps" && Array.isArray(item)
          ? item.flatMap((step) => step && typeof step === "object" ? Object.values(step) : [])
          : [item];
        for (const entry of items) {
          if (typeof entry !== "string" || !entry.trim()) continue;
          totalLocalizableFields++;
          const structuredMapping = field === "steps" && row.kind === "sop"
            ? MANUAL_SOP_STEP_ARABIC_DRAFT[row.id]?.[entry]
            : undefined;
          if (!MANUAL_ARABIC_DRAFT[entry] && !MACHINE_DRAFT_GAPS[entry] && !ARABIC_CHAPTERS[entry] && !structuredMapping) {
            blockers.push({ kind: row.kind, id: row.id, field, state: "MISSING_TRANSLATION_MAPPING" });
          }
        }
      }
    }
  }
  return {
    totalLocalizableFields,
    matchedMappings: totalLocalizableFields - blockers.length,
    missingMappings: blockers.length,
    blockers,
  };
}

export class ManualPreflightBlockedError extends Error {
  preflight: ManualPreflight;
  constructor(preflight: ManualPreflight) {
    super("Manual localization preflight blocked import");
    this.name = "ManualPreflightBlockedError";
    this.preflight = preflight;
  }
}

export async function ensureLocalizedCorpus(pool: Pool): Promise<void> {
  // The operation is explicit and transactional. Runtime GET/search handlers
  // never call this function.
  const preflight = await runManualImportPreflight(pool);
  if (preflight.missingMappings > 0) {
    throw new ManualPreflightBlockedError(preflight);
  }
  await ensureKCSetup(pool);
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    // Earlier draft imports predate lifecycle metadata and therefore received
    // the column default. Only records with no reviewer evidence are normalized;
    // reviewed/approved content is never reclassified or overwritten.
    await client.query(`
      UPDATE manual_chapter_localizations
         SET translation_status = 'draft_machine_generated'
       WHERE locale = 'ar'
         AND translation_status = 'review_required'
         AND reviewed_at IS NULL
         AND reviewed_by_id IS NULL
    `);
    await client.query(`
      INSERT INTO manual_chapter_localizations
        (chapter_id, locale, title, description)
      SELECT id, 'en', title, description FROM manual_chapters
      ON CONFLICT (chapter_id, locale) DO UPDATE
        SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
    `);
    const { rows: chapterRows } = await client.query<{ id: number; title: string; description: string | null }>(
      "SELECT id, title, description FROM manual_chapters",
    );
    for (const row of chapterRows) {
      const source = { title: row.title, description: row.description };
      const checksum = manualSourceChecksum(source);
      const legacyChecksums = legacyManualSourceChecksums("chapter", row.id, source);
      await client.query(
        `INSERT INTO manual_chapter_localizations (chapter_id, locale, title, description, translation_status)
         VALUES ($1,'ar',$2,$3,'draft_machine_generated')
         ON CONFLICT (chapter_id, locale) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
           translation_status='draft_machine_generated', updated_at=NOW()
          WHERE manual_chapter_localizations.translation_status = 'draft_machine_generated'
            AND manual_chapter_localizations.source_checksum IS NULL`,
        [row.id, arabicManualText(row.title), arabicManualText(row.description)],
      );
      await client.query(
        `UPDATE manual_chapter_localizations
            SET translation_status=CASE WHEN source_checksum IS NOT NULL AND source_checksum IS DISTINCT FROM $2 AND source_checksum <> ALL($3::text[]) THEN 'review_required' ELSE translation_status END,
                source_checksum=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2 ELSE source_checksum END,
                source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
          WHERE chapter_id=$1 AND locale='ar'`,
        [row.id, checksum, legacyChecksums],
      );
    }
    const { rows: sections } = await client.query<{ id: number; title: string; content: string }>(
      "SELECT id, title, content FROM manual_sections",
    );
    for (const row of sections) {
      const source = { title: row.title, content: row.content };
      const checksum = manualSourceChecksum(source);
      const legacyChecksums = legacyManualSourceChecksums("section", row.id, source);
      await client.query(
        `INSERT INTO manual_section_localizations (section_id, locale, title, content, translation_status)
         VALUES ($1,'en',$2,$3,'review_required'), ($1,'ar',$4,$5,'draft_machine_generated')
         ON CONFLICT (section_id, locale) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, updated_at=NOW()
          WHERE manual_section_localizations.translation_status = 'draft_machine_generated'
            AND manual_section_localizations.source_checksum IS NULL`,
        [row.id, row.title, row.content, arabicManualText(row.title), arabicManualText(row.content)],
      );
      await client.query(
        `UPDATE manual_section_localizations
            SET translation_status=CASE WHEN source_checksum IS NOT NULL AND source_checksum IS DISTINCT FROM $2 AND source_checksum <> ALL($3::text[]) THEN 'review_required' ELSE translation_status END,
                source_checksum=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2 ELSE source_checksum END,
                source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
          WHERE section_id=$1 AND locale='ar'`,
        [row.id, checksum, legacyChecksums],
      );
    }
    const { rows: sops } = await client.query<{
      id: number; process_name: string; purpose: string | null; responsible_role: string | null;
      steps: string[] | null; required_inputs: string | null; approval_flow: string | null;
      outputs: string | null; timeline: string | null; related_module: string | null; notifications: string | null;
    }>(
      `SELECT id, process_name, purpose, responsible_role, steps, required_inputs, approval_flow, outputs, timeline, related_module, notifications FROM manual_sops`,
    );
    for (const row of sops) {
      const source = {
        process_name: row.process_name,
        purpose: row.purpose,
        responsible_role: row.responsible_role,
        steps: parseManualSteps(row.steps),
        required_inputs: row.required_inputs,
        approval_flow: row.approval_flow,
        outputs: row.outputs,
        timeline: row.timeline,
        related_module: row.related_module,
        notifications: row.notifications,
      };
      const checksum = manualSourceChecksum(source);
      const legacyChecksums = legacyManualSourceChecksums("sop", row.id, source);
      const ar = (v: string | null) => v ? arabicManualText(v) : null;
      const arSteps = translateManualSteps(row.steps, row.id);
      await client.query(
        `INSERT INTO manual_sop_localizations
         (sop_id, locale, process_name, purpose, responsible_role, steps, required_inputs, approval_flow, outputs, timeline, related_module, notifications, translation_status)
         VALUES ($1,'en',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'review_required'),
                ($1,'ar',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'draft_machine_generated')
         ON CONFLICT (sop_id, locale) DO UPDATE SET process_name=EXCLUDED.process_name, purpose=EXCLUDED.purpose,
           responsible_role=EXCLUDED.responsible_role, steps=EXCLUDED.steps, required_inputs=EXCLUDED.required_inputs,
           approval_flow=EXCLUDED.approval_flow, outputs=EXCLUDED.outputs, timeline=EXCLUDED.timeline,
           related_module=EXCLUDED.related_module, notifications=EXCLUDED.notifications, updated_at=NOW()
          WHERE manual_sop_localizations.translation_status = 'draft_machine_generated'
            AND manual_sop_localizations.source_checksum IS NULL`,
        [row.id, row.process_name, row.purpose, row.responsible_role, row.steps ? JSON.stringify(row.steps) : null, row.required_inputs, row.approval_flow, row.outputs, row.timeline, row.related_module, row.notifications,
          ar(row.process_name) ?? row.process_name, ar(row.purpose), ar(row.responsible_role), JSON.stringify(arSteps), ar(row.required_inputs), ar(row.approval_flow), ar(row.outputs), ar(row.timeline), ar(row.related_module), ar(row.notifications)],
      );
      if ([7, 8, 9].includes(row.id)) {
        const { rows: existingRows } = await client.query<{
          steps: unknown;
          source_checksum: string | null;
          translation_status: string;
          reviewed_at: Date | null;
          reviewed_by_id: number | null;
        }>(
          `SELECT steps, source_checksum, translation_status, reviewed_at, reviewed_by_id
             FROM manual_sop_localizations
            WHERE sop_id=$1 AND locale='ar'
            FOR UPDATE`,
          [row.id],
        );
        const existing = existingRows[0];
        const storedSteps = parseManualSteps(existing?.steps);
        if (existing && JSON.stringify(storedSteps) === JSON.stringify(arSteps)
            && !existing.reviewed_at && !existing.reviewed_by_id
            && existing.translation_status !== "reviewed"
            && existing.translation_status !== "approved"
            && existing.source_checksum !== checksum) {
          await client.query(
            `UPDATE manual_sop_localizations
                SET source_checksum=$2, source_updated_at=NOW()
              WHERE sop_id=$1 AND locale='ar' AND source_checksum=$3`,
            [row.id, checksum, existing.source_checksum],
          );
        }
      }
      await client.query(
        `UPDATE manual_sop_localizations
            SET translation_status=CASE
                  WHEN source_checksum IS NOT NULL
                    AND source_checksum IS DISTINCT FROM $2
                    AND source_checksum <> ALL($3::text[])
                  THEN 'review_required' ELSE translation_status END,
                source_checksum=CASE
                  WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2
                  ELSE source_checksum END,
                source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
          WHERE sop_id=$1 AND locale='ar'`,
        [row.id, checksum, legacyChecksums],
      );
    }
    const { rows: faqs } = await client.query<{ id: number; question: string; answer: string; category: string }>(
      "SELECT id, question, answer, category FROM manual_faqs",
    );
    for (const row of faqs) {
      const source = { question: row.question, answer: row.answer, category: row.category };
      const checksum = manualSourceChecksum(source);
      const legacyChecksums = legacyManualSourceChecksums("faq", row.id, source);
      await client.query(
        `INSERT INTO manual_faq_localizations (faq_id, locale, question, answer, category, translation_status)
         VALUES ($1,'en',$2,$3,$4,'review_required'), ($1,'ar',$5,$6,$7,'draft_machine_generated')
         ON CONFLICT (faq_id, locale) DO UPDATE SET question=EXCLUDED.question, answer=EXCLUDED.answer,
           category=EXCLUDED.category, updated_at=NOW()
          WHERE manual_faq_localizations.translation_status = 'draft_machine_generated'
            AND manual_faq_localizations.source_checksum IS NULL`,
          [row.id, row.question, row.answer, row.category, arabicManualText(row.question), arabicManualText(row.answer), arabicManualText(row.category)],
      );
      await client.query(
        `UPDATE manual_faq_localizations
            SET translation_status=CASE
                  WHEN source_checksum IS NOT NULL
                    AND source_checksum IS DISTINCT FROM $2
                    AND source_checksum <> ALL($3::text[])
                  THEN 'review_required' ELSE translation_status END,
                source_checksum=CASE
                  WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2
                  ELSE source_checksum END,
                source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
          WHERE faq_id=$1 AND locale='ar'`,
        [row.id, checksum, legacyChecksums],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

let seeded = false;
export async function ensureSeeded(db: QueryExecutor, pool: Pool): Promise<void> {
  if (seeded) return;
  const { rows } = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM manual_chapters",
  );
  if (rows[0].n > 0) {
    seeded = true;
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let ci = 0; ci < INITIAL_CHAPTERS.length; ci++) {
      const ch = INITIAL_CHAPTERS[ci];
      const { rows: cr } = await client.query<{ id: number }>(
        `INSERT INTO manual_chapters (title, slug, description, icon, "order", language, status)
         VALUES ($1,$2,$3,$4,$5,'en','published') RETURNING id`,
        [ch.title, ch.slug, ch.description, ch.icon, ci + 1],
      );
      const chapterId = cr[0].id;
      for (let si = 0; si < ch.sections.length; si++) {
        const s = ch.sections[si];
        await client.query(
          `INSERT INTO manual_sections (chapter_id, title, content, "order") VALUES ($1,$2,$3,$4)`,
          [chapterId, s.title, s.content, si + 1],
        );
      }
      if (ch.sops) {
        for (let oi = 0; oi < ch.sops.length; oi++) {
          const sop = ch.sops[oi];
          await client.query(
            `INSERT INTO manual_sops
             (chapter_id, process_name, purpose, responsible_role, steps, required_inputs,
              approval_flow, outputs, timeline, related_module, notifications, "order")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              chapterId,
              sop.processName,
              sop.purpose,
              sop.responsibleRole,
              JSON.stringify(sop.steps),
              sop.requiredInputs,
              sop.approvalFlow,
              sop.outputs,
              sop.timeline,
              sop.relatedModule,
              sop.notifications,
              oi + 1,
            ],
          );
        }
      }
    }
    await client.query("COMMIT");
    seeded = true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let terminologyMigrated = false;
export async function ensureTerminologyMigrated(db: QueryExecutor): Promise<void> {
  if (terminologyMigrated) return;
  try {
    // ── Chapter title fixes (idempotent: only update when stale) ──────────
    const chapterTitleFixes: [string, string][] = [
      ["document-repository", "File & Archive"],
      ["communication", "Communication Centre"],
      ["ai-assistant", "AI"],
    ];
    for (const [slug, title] of chapterTitleFixes) {
      await db.query(
        `UPDATE manual_chapters SET title = $1, updated_at = NOW() WHERE slug = $2 AND title != $1`,
        [title, slug],
      );
    }

    // ── Obsolete terminology replacement (all displayed fields) ───────────
    const obsolete: [string, string][] = [
      ["Program Manager", "Programme Manager"],
      ["State Program Officer", "State Programme Officer"],
      ["Senior Program Coordinator", "Senior Programme Coordinator"],
      ["Senior Coordinator", "Senior Programme Coordinator"],
      ["Communication Center", "Communication Centre"],
      ["Communication module", "Communication Centre"],
      ["Document Repository", "File & Archive"],
      ["AI Assistant Settings", "AI"],
      ["AI Assistant", "AI"],
      ["Program State Report", "State Programme Report"],
      ["Program State", "State Programme"],
    ];
    for (const [old, nw] of obsolete) {
      // chapter titles and descriptions
      await db.query(
        `UPDATE manual_chapters SET
           title = REPLACE(title, $1, $2),
           description = REPLACE(COALESCE(description,''), $1, $2),
           updated_at = NOW()
         WHERE title LIKE '%' || $1 || '%'
            OR description LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // section titles and content
      await db.query(
        `UPDATE manual_sections SET
           title = REPLACE(title, $1, $2),
           content = REPLACE(content, $1, $2)
         WHERE title LIKE '%' || $1 || '%'
            OR content LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // SOP all text fields
      await db.query(
        `UPDATE manual_sops SET
           process_name     = REPLACE(COALESCE(process_name,''),     $1, $2),
           purpose          = REPLACE(COALESCE(purpose,''),          $1, $2),
           responsible_role = REPLACE(COALESCE(responsible_role,''), $1, $2),
           approval_flow    = REPLACE(COALESCE(approval_flow,''),    $1, $2),
           notifications    = REPLACE(COALESCE(notifications,''),    $1, $2),
           related_module   = REPLACE(COALESCE(related_module,''),   $1, $2)
         WHERE process_name     LIKE '%' || $1 || '%'
            OR purpose          LIKE '%' || $1 || '%'
            OR responsible_role LIKE '%' || $1 || '%'
            OR approval_flow    LIKE '%' || $1 || '%'
            OR notifications    LIKE '%' || $1 || '%'
            OR related_module   LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // FAQ questions and answers
      await db.query(
        `UPDATE manual_faqs SET
           question = REPLACE(question, $1, $2),
           answer   = REPLACE(answer,   $1, $2)
         WHERE question LIKE '%' || $1 || '%'
            OR answer   LIKE '%' || $1 || '%'`,
        [old, nw],
      );
    }
    terminologyMigrated = true;
  } catch {
    // Non-fatal: migration retried on next request
    terminologyMigrated = false;
  }
}

async function seedFAQs(db: QueryExecutor): Promise<void> {
  for (const f of FAQ_SEED) {
    await db.query(
      `INSERT INTO manual_faqs (question, answer, category, "order") VALUES ($1,$2,$3,$4)`,
      [f.question, f.answer, f.category, f.order],
    );
  }
}

let kcSetupDone = false;
export async function ensureKCSetup(db: QueryExecutor): Promise<void> {
  if (kcSetupDone) return;
  try {
    const { rows: cnt } = await db.query<{ c: string }>(`SELECT COUNT(*) AS c FROM manual_faqs`);
    if (Number(cnt[0].c) === 0) await seedFAQs(db);
    kcSetupDone = true;
    // Idempotent: fix obsolete terminology in existing rows (no-op if already correct)
    await ensureTerminologyMigrated(db);
  } catch {
    kcSetupDone = false;
  }
}

// Editing a chapter/section/SOP's English source content previously never
// touched its translated localization rows at all — translation_status only
// ever changed via the explicit admin "import machine draft" action
// (ensureLocalizedCorpus, checksum-diffed), so an ordinary content edit left
// a stale Arabic translation with no visible "needs review" signal anywhere.
// This marks every existing localization row for the edited entity stale
// immediately, the moment any translatable field is touched in the request —
// erring toward re-review even on a no-op resave, rather than ever missing
// a real content change.
export async function markLocalizationsStale(
  db: QueryExecutor,
  table: "manual_chapter_localizations" | "manual_section_localizations" | "manual_sop_localizations",
  fkColumn: "chapter_id" | "section_id" | "sop_id",
  entityId: number,
): Promise<void> {
  await db.query(
    `UPDATE ${table} SET translation_status = 'review_required', updated_at = NOW()
     WHERE ${fkColumn} = $1 AND translation_status <> 'review_required'`,
    [entityId],
  );
}

export function chapterSelect(locale: ManualLocale = "en"): string {
  return `
  SELECT mc.id,
         CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS title,
         mc.slug,
         CASE WHEN '${locale}' = 'ar' THEN mcl.description ELSE mc.description END AS description,
         mc.icon,
         mc."order", mc.language, mc.status,
         mc.created_by_id AS "createdById", mc.updated_by_id AS "updatedById",
         mc.created_at AS "createdAt", mc.updated_at AS "updatedAt",
         (SELECT COUNT(*)::int FROM manual_sections ms WHERE ms.chapter_id = mc.id) AS "sectionCount",
         (SELECT COUNT(*)::int FROM manual_sops mso WHERE mso.chapter_id = mc.id) AS "sopCount"
  FROM manual_chapters mc
  LEFT JOIN manual_chapter_localizations mcl
    ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
`;
}
