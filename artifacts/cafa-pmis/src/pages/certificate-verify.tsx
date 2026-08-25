import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Award, CheckCircle, XCircle, Search, ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type CertResult = {
  certificateId: string;
  trainingVideoTitle: string;
  userName: string;
  userRole: string;
  issuedAt: string;
  revokedAt: string | null;
  isActive: boolean;
};

const ROLE_DISPLAY: Record<string, string> = {
  super_admin:           "System Administrator",
  executive_director:    "Executive Director",
  program_manager:       "Programme Manager",
  senior_program_coordinator:    "Senior Programme Coordinator",
  technical_coordinator: "Technical Coordinator",
  state_office_manager:         "State Manager",
  state_program_officer:         "State Officer",
};

async function apiFetch(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    throw new Error((err as { error?: string }).error ?? "request_failed");
  }
  return res.json();
}

export default function CertificateVerifyPage({ certId }: { certId: string }) {
  const { t } = useTranslation("knowledge");
  const [input, setInput] = useState(certId ?? "");
  const [query, setQuery] = useState(certId ?? "");

  const { data, isLoading, error, isFetching } = useQuery<{ certificate: CertResult }>({
    queryKey: ["cert-verify", query],
    queryFn: () => apiFetch(`/api/training-certificates/verify/${encodeURIComponent(query)}`),
    enabled: !!query,
    retry: false,
  });

  const cert = data?.certificate;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <Link href="/manual">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("certificateVerify.backToManual")}
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#1a3c5e]" />
          <h1 className="font-bold text-[#1a3c5e]">{t("certificateVerify.pageTitle")}</h1>
        </div>
        <div className="ms-auto text-xs text-muted-foreground">{t("certificateVerify.registryLabel")}</div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-8">
        {/* Hero */}
        <div className="text-center max-w-lg">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-[#1a2744] mb-5">
            <Award className="h-8 w-8 text-[#e8a012]" />
          </div>
          <h2 className="text-2xl font-bold text-[#1a3c5e] mb-2">{t("certificateVerify.heroTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("certificateVerify.heroDescription")}
          </p>
        </div>

        {/* Search */}
        <Card className="w-full max-w-lg shadow-sm">
          <CardContent className="pt-5 pb-5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) setQuery(input.trim().toUpperCase()); }}
                  placeholder={t("certificateVerify.inputPlaceholder")}
                  className="ps-9 font-mono text-sm h-10"
                />
              </div>
              <Button
                onClick={() => { if (input.trim()) setQuery(input.trim().toUpperCase()); }}
                disabled={!input.trim() || isFetching}
                className="bg-[#1a2744] hover:bg-[#2d3f6b] h-10"
              >
                {isFetching ? t("certificateVerify.verifying") : t("certificateVerify.verify")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        {isLoading && (
          <div className="text-sm text-muted-foreground animate-pulse">{t("certificateVerify.checkingRegistry")}</div>
        )}

        {error && !isLoading && (
          <Card className="w-full max-w-lg border-red-200 bg-red-50 shadow-sm">
            <CardContent className="pt-5 pb-5 flex items-start gap-4">
              <XCircle className="h-8 w-8 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-700 mb-1">{t("certificateVerify.notFoundTitle")}</p>
                <p className="text-sm text-red-600">
                  {t("certificateVerify.notFoundBefore")} <code className="font-mono bg-red-100 px-1 rounded">{query}</code> {t("certificateVerify.notFoundAfter")}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {cert && !isLoading && (
          <Card className={`w-full max-w-lg shadow-sm ${cert.isActive ? "border-emerald-200" : "border-red-200"}`}>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-4 mb-5">
                {cert.isActive ? (
                  <CheckCircle className="h-8 w-8 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-8 w-8 text-red-500 shrink-0" />
                )}
                <div>
                  <p className={`font-semibold text-base ${cert.isActive ? "text-emerald-700" : "text-red-700"}`}>
                    {cert.isActive ? t("certificateVerify.validTitle") : t("certificateVerify.revokedTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {cert.isActive
                      ? t("certificateVerify.validDescription")
                      : t("certificateVerify.revokedDescription")
                    }
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldCertificateId")}</span>
                  <code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded font-bold">{cert.certificateId}</code>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldRecipient")}</span>
                  <span className="font-medium">{cert.userName}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldRole")}</span>
                  <Badge variant="outline" className="text-xs">{ROLE_DISPLAY[cert.userRole] ?? cert.userRole}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldTraining")}</span>
                  <span className="font-medium text-end max-w-[55%] text-xs leading-snug">{cert.trainingVideoTitle}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldIssued")}</span>
                  <span>{new Date(cert.issuedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
                </div>
                {!cert.isActive && cert.revokedAt && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-muted-foreground">{t("certificateVerify.fieldRevoked")}</span>
                    <span className="text-red-600">{new Date(cert.revokedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">{t("certificateVerify.fieldAuthorisedBy")}</span>
                  <span className="text-xs text-muted-foreground">{t("certificateVerify.authorisedByValue")}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center max-w-sm">
          {t("certificateVerify.footerNote")}
        </p>
      </main>
    </div>
  );
}
