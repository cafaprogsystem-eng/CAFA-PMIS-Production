import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

function parseStructuredSteps(value: unknown): unknown {
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

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeValue(item)]),
  );
}

export function canonicalizeManualSource(source: JsonRecord): JsonRecord {
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      key === "steps" ? parseStructuredSteps(value) : value,
    ]),
  );
  return canonicalizeValue(normalized) as JsonRecord;
}

export function manualSourceChecksum(source: JsonRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeManualSource(source)))
    .digest("hex");
}

/**
 * Compatibility candidates for checksums written before canonicalization.
 * They prove logical equivalence without treating every mismatch as benign.
 */
export function legacyManualSourceChecksums(
  kind: string,
  id: number,
  source: JsonRecord,
): string[] {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (kind === "chapter") {
    return [hash({ title: source.title, description: source.description })];
  }
  if (kind === "section") {
    return [hash({ title: source.title, content: source.content })];
  }
  if (kind === "sop") {
    const legacySop = (steps: unknown) => ({
      id,
      process_name: source.process_name,
      purpose: source.purpose,
      responsible_role: source.responsible_role,
      steps,
      required_inputs: source.required_inputs,
      approval_flow: source.approval_flow,
      outputs: source.outputs,
      timeline: source.timeline,
      related_module: source.related_module,
      notifications: source.notifications,
    });
    return [
      hash(legacySop(source.steps)),
      hash(legacySop(JSON.stringify(source.steps))),
      hash(legacySop(JSON.stringify(JSON.stringify(source.steps)))),
    ];
  }
  if (kind === "faq") {
    const oldFaqSource = {
      question: source.question,
      answer: source.answer,
      category: source.category,
    };
    return [hash(oldFaqSource)];
  }
  return [];
}