export type AuthorizationContext = {
  user?: {
    id?: number;
    role?: string;
    stateId?: number | null;
    sector?: string | null;
    status?: string;
  };
  permissions?: string[];
};

function assignedSectors(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map((sector) => sector.trim()).filter(Boolean).sort();
}

export function authorizationFingerprint(value: AuthorizationContext | null | undefined): string | null {
  const user = value?.user;
  if (!user || !Number.isSafeInteger(user.id) || Number(user.id) <= 0) return null;
  return JSON.stringify({
    id: user.id,
    role: user.role ?? null,
    stateId: user.stateId ?? null,
    sectors: assignedSectors(user.sector),
    status: user.status ?? null,
    permissions: [...(value?.permissions ?? [])].sort(),
  });
}

export function canViewHqSectorSnapshot(
  value: AuthorizationContext | null | undefined,
  sector: string,
): boolean {
  const fingerprint = authorizationFingerprint(value);
  if (!fingerprint || !sector) return false;
  const permissions = value?.permissions ?? [];
  if (!permissions.includes("*") && !permissions.includes("reports.view")) return false;
  const role = value?.user?.role;
  if (role === "state_office_manager" || role === "state_program_officer") return false;
  if (role !== "technical_coordinator") return true;
  return assignedSectors(value?.user?.sector).includes(sector);
}