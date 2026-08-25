/**
 * SPR-010 — Canonical section taxonomy for State Programme Report (SPR)
 * reviewer comments. Must mirror artifacts/api-server/src/lib/sprSections.ts.
 */
export const SPR_SECTION_KEYS = [
  "general",
  "humanitarian_context",
  "sectors_covered",
  "localities_covered",
  "related_projects",
  "activities",
  "key_achievements",
  "main_challenges",
  "mitigation_measures",
  "next_period_priorities",
  "lessons_learned",
  "coordination_updates",
  "community_feedback",
  "hq_support_requests",
  "risks",
  "evidence",
] as const;

export type SprSectionKey = (typeof SPR_SECTION_KEYS)[number];

export const SPR_SECTION_LABELS: Record<SprSectionKey, string> = {
  general: "General / Report-Level",
  humanitarian_context: "Humanitarian Context",
  sectors_covered: "Sectors Covered",
  localities_covered: "Localities Covered",
  related_projects: "Related Projects",
  activities: "Activities",
  key_achievements: "Key Achievements",
  main_challenges: "Main Challenges",
  mitigation_measures: "Mitigation Measures",
  next_period_priorities: "Next Period Priorities",
  lessons_learned: "Lessons Learned",
  coordination_updates: "Coordination Updates",
  community_feedback: "Community Feedback",
  hq_support_requests: "HQ Support Requests",
  risks: "Risks & Issues",
  evidence: "Supporting Attachments / Evidence",
};

export function getSprSectionLabel(key: string): string {
  return (SPR_SECTION_LABELS as Record<string, string>)[key] ?? key;
}
