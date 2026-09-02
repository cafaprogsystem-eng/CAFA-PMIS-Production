import { Bot, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetMe } from "@workspace/api-client-react";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { AIAdministrationPanel } from "@/pages/ai-settings";

/**
 * Canonical AI workspace. The assistant is available to every authenticated
 * user; administration remains a permission-gated section backed by the
 * existing settings (ai.settings.manage) and logs (ai.logs.view) endpoints —
 * matching the backend exactly, rather than a separate hardcoded role list
 * that can drift from it (the backend also grants ai.logs.view to
 * program_manager, who previously had no frontend path to this section at all).
 */
export default function AIPage() {
  const { t } = useTranslation("ai");
  const { data: me } = useGetMe();
  const myPerms = me?.permissions ?? [];
  const isAdmin = myPerms.includes("*") || myPerms.includes("ai.settings.manage") || myPerms.includes("ai.logs.view");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <section aria-labelledby="ai-assistant-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 id="ai-assistant-heading" className="text-base font-semibold text-foreground">
            {t("workspace.assistantHeading")}
          </h2>
        </div>
        <AIChatWidget embedded />
      </section>

      {isAdmin && (
        <section aria-labelledby="ai-administration-heading" className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id="ai-administration-heading" className="text-base font-semibold text-foreground">
              {t("workspace.administrationHeading")}
            </h2>
          </div>
          <AIAdministrationPanel showHeading={false} />
        </section>
      )}
    </div>
  );
}