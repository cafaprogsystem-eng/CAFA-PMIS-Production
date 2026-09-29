import { Chip } from "@heroui/react";

type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

/** Report workflow status → HeroUI Chip colour, shared by the registry and viewers. */
const REPORT_STATUS_COLOR: Record<string, ChipColor> = {
  draft: "default",
  submitted: "accent",
  state_reviewed: "accent",
  technically_approved: "accent",
  coordination_approved: "accent",
  approved: "success",
  returned: "warning",
  rejected: "danger",
  archived: "default",
};

export function reportStatusColor(status: string): ChipColor {
  return REPORT_STATUS_COLOR[status] ?? "default";
}

export function ReportStatusChip({ status, label, className }: { status: string; label: string; className?: string }) {
  return (
    <Chip size="sm" variant="soft" color={reportStatusColor(status)} className={className}>
      {label}
    </Chip>
  );
}
