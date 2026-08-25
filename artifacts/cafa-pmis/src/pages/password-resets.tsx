import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, ShieldOff, RotateCcw, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetMe } from "@workspace/api-client-react";
import { toast } from "sonner";
import { hasPerm } from "@/lib/format";

type TokenRow = {
  id: number;
  status: "active" | "used" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  userId: number;
  userName: string;
  userEmail: string;
  totalRequestsForUser: number;
  lastSuccessfulReset: string | null;
};

type Summary = { total: number; active: number; used: number; expired: number; revoked: number };

function statusBadge(status: TokenRow["status"], t: (key: string) => string) {
  switch (status) {
    case "active":  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">{t("common:passwordResetStatus.active")}</Badge>;
    case "used":    return <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">{t("common:passwordResetStatus.used")}</Badge>;
    case "expired": return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">{t("common:passwordResetStatus.expired")}</Badge>;
    case "revoked": return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">{t("common:passwordResetStatus.revoked")}</Badge>;
  }
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function shortenUA(ua: string | null) {
  if (!ua) return "—";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  if (ua.includes("curl")) return "curl";
  return ua.slice(0, 30);
}

export default function PasswordResetsPage() {
  const { t } = useTranslation("auth");
  const { data: me } = useGetMe();
  const perms = me?.permissions ?? [];
  const isAdmin = hasPerm(perms, "*") || me?.user?.role === "super_admin" || me?.user?.role === "executive_director";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const qc = useQueryClient();

  const queryKey = ["password-reset-tokens", search, statusFilter];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/password-reset-tokens?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<{ tokens: TokenRow[]; total: number; summary: Summary }>;
    },
    refetchInterval: 30_000,
    enabled: isAdmin,
  });

  const revokeMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/password-reset-tokens/${id}/revoke`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["password-reset-tokens"] }); toast.success(t("passwordResets.tokenRevoked")); },
    onError: () => toast.error(t("passwordResets.revokeError")),
  });

  const resendMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/password-reset-tokens/${id}/resend`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["password-reset-tokens"] }); toast.success(t("passwordResets.resentSuccess")); },
    onError: () => toast.error(t("passwordResets.resentError")),
  });

  const exportCsv = () => {
    if (!data?.tokens) return;
    const rows = [
      ["ID", "User", "Email", "Status", "Requested At", "Expires At", "Used At", "Revoked At", "IP Address", "Browser", "Total Requests"],
      ...data.tokens.map((t) => [
        t.id, t.userName, t.userEmail, t.status,
        fmt(t.createdAt), fmt(t.expiresAt), fmt(t.usedAt), fmt(t.revokedAt),
        t.ipAddress ?? "", shortenUA(t.userAgent), t.totalRequestsForUser,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `password-reset-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground text-sm">{t("passwordResets.noPermission")}</p>
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <ShieldOff className="h-7 w-7 text-primary" /> {t("passwordResets.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("passwordResets.description")}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: t("passwordResets.total"), value: s?.total ?? "—", color: "" },
          { label: t("passwordResets.active"), value: s?.active ?? "—", color: "text-emerald-600" },
          { label: t("passwordResets.used"), value: s?.used ?? "—", color: "text-blue-600" },
          { label: t("passwordResets.expired"), value: s?.expired ?? "—", color: "text-amber-600" },
          { label: t("passwordResets.revoked"), value: s?.revoked ?? "—", color: "text-red-600" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t("passwordResets.tokenLog")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("passwordResets.searchPlaceholder")} className="ps-9" value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder={t("passwordResets.statusFilter")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("passwordResets.allStatuses")}</SelectItem>
                <SelectItem value="active">{t("passwordResets.active")}</SelectItem>
                <SelectItem value="used">{t("passwordResets.used")}</SelectItem>
                <SelectItem value="expired">{t("passwordResets.expired")}</SelectItem>
                <SelectItem value="revoked">{t("passwordResets.revoked")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["password-reset-tokens"] })} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> {t("passwordResets.refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> {t("passwordResets.exportCsv")}
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !data?.tokens.length ? (
            <div className="text-center py-12 text-muted-foreground text-sm">{t("passwordResets.noRecords")}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("passwordResets.user")}</TableHead>
                    <TableHead>{t("passwordResets.status")}</TableHead>
                    <TableHead>{t("passwordResets.requested")}</TableHead>
                    <TableHead>{t("passwordResets.expires")}</TableHead>
                    <TableHead>{t("passwordResets.ipAddress")}</TableHead>
                    <TableHead>{t("passwordResets.browser")}</TableHead>
                    <TableHead className="text-end">{t("passwordResets.totalReqs")}</TableHead>
                    <TableHead>{t("passwordResets.lastReset")}</TableHead>
                    <TableHead className="text-end">{t("passwordResets.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tokens.map((tok) => (
                    <TableRow key={tok.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{tok.userName}</div>
                        <div className="text-xs text-muted-foreground">{tok.userEmail}</div>
                      </TableCell>
                      <TableCell>{statusBadge(tok.status, t)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(tok.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(tok.expiresAt)}</TableCell>
                      <TableCell className="text-xs font-mono">{tok.ipAddress ?? "—"}</TableCell>
                      <TableCell className="text-xs">{shortenUA(tok.userAgent)}</TableCell>
                      <TableCell className="text-end text-sm">{tok.totalRequestsForUser}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(tok.lastSuccessfulReset)}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          {tok.status === "active" && (
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => revokeMut.mutate(tok.id)} disabled={revokeMut.isPending}>
                              <ShieldOff className="h-3 w-3" /> {t("passwordResets.revokeAction")}
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                            onClick={() => resendMut.mutate(tok.id)} disabled={resendMut.isPending}>
                            <RotateCcw className="h-3 w-3" /> {t("passwordResets.resendAction")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {data && <p className="text-xs text-muted-foreground mt-3">{data.total} {t("passwordResets.totalRecords")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
