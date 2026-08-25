import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Trans, useTranslation } from "react-i18next";
import { Bot, X, Minimize2, Send, Trash2, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

type Msg = { id: string; role: "user" | "assistant"; content: string; streaming?: boolean };

const QUICK_PROMPT_KEYS = [
  "createProject",
  "submitReport",
  "pendingApprovals",
  "explainPermissions",
  "uploadDocument",
  "exportPdf",
  "approvalSteps",
  "updateActionPlan",
] as const;

// Roles that can see the widget even when AI is disabled (to show the UAT status info)
const ADMIN_ROLES = new Set(["super_admin", "executive_director"]);

function newId() { return Math.random().toString(36).slice(2); }

export function AIChatWidget({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("ai");
  const [open, setOpen] = useState(embedded);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevOpenRef = useRef(false);
  const [location] = useLocation();
  const { data: meData } = useGetMe();
  const user = meData?.user;

  const isAdminRole = ADMIN_ROLES.has(user?.role ?? "");

  // Reactive AI settings — shares the ["ai-settings"] cache with the settings page,
  // so disabling AI from the admin page causes this widget to disappear immediately.
  const { data: aiSettings } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => {
      const r = await fetch("/api/ai/settings", { credentials: "include" });
      if (!r.ok) return { enabled: "true", envEnabled: false, reason: null };
      return r.json() as Promise<{ enabled: string; envEnabled?: boolean; reason?: string | null }>;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  // AI is truly operational only when BOTH the env flag (AI_ENABLED=true on the
  // server) AND the admin DB toggle are enabled. The envEnabled field lets us
  // distinguish "admin disabled" from "UAT mode / env flag off".
  const envEnabled = aiSettings?.envEnabled !== false;
  const dbEnabled = aiSettings?.enabled !== "false";
  const enabled = envEnabled && dbEnabled;
  const disabledReason = enabled ? null : (!envEnabled ? "uat_mode" : "admin_disabled");

  // Keep the embedded experience permanently open; the floating widget can
  // still respond to legacy programmatic open events elsewhere in the app.
  useEffect(() => {
    if (embedded) {
      setOpen(true);
      setMinimized(false);
      return;
    }
    const handler = () => { setOpen(true); setMinimized(false); };
    document.addEventListener("open-ai-chat", handler);
    return () => document.removeEventListener("open-ai-chat", handler);
  }, [embedded]);

  // Return keyboard focus to launcher when panel closes
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      launcherRef.current?.focus();
    }
    prevOpenRef.current = open;
  }, [open]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => { if (open && !minimized) scrollToBottom(); }, [messages, open, minimized, scrollToBottom]);

  useEffect(() => {
    if (open && !minimized && enabled) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, minimized, enabled]);

  // Welcome message (only shown when AI is enabled)
  useEffect(() => {
    if (open && enabled && messages.length === 0) {
      setMessages([{
        id: newId(),
        role: "assistant",
        content: t("widget.welcome", { name: user?.name ? `, ${user.name.split(" ")[0]}` : "" }),
      }]);
    }
  }, [open, enabled, messages.length, user?.name, t]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming || !enabled) return;
    const userMsg: Msg = { id: newId(), role: "user", content: text.trim() };
    const assistantId = newId();
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", streaming: true }]);
    setInput("");
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const lang = (meData?.user as unknown as Record<string, string | undefined>)?.languagePreference ?? "en";
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: abort.signal,
        body: JSON.stringify({ message: text.trim(), currentPage: location, sessionId, lang }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.message ?? err.error ?? t("widget.failedResponse");
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: errMsg, streaming: false } : m));
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              full += data.content;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: full } : m));
            }
            if (data.done) {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content || t("widget.stopped"), streaming: false } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: t("widget.networkError"), streaming: false } : m));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  function clearHistory() {
    fetch("/api/ai/history", { method: "DELETE", credentials: "include" }).catch(() => {});
    setMessages([]);
  }

  function stop() { abortRef.current?.abort(); }

  // Not logged in → nothing
  if (!user) return null;

  // The canonical workspace renders its own embedded assistant.
  if (!embedded && location === "/ai") return null;

  // AI disabled + not an admin role → hide completely (no impact on other modules)
  if (!enabled && !isAdminRole && !embedded) return null;

  const uatMessage = disabledReason === "uat_mode"
    ? t("widget.uatDisabled")
    : t("widget.adminDisabled");

  // Shared positioning — launcher: 24px from bottom/right; panel: 12px above launcher
  const launcherBottomStyle = "calc(max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem)))";
  const panelBottomStyle   = "calc(max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem)) + 48px + 12px)";

  return (
    <>
      {!embedded && (
        /* ── Floating launcher (icon changes when panel is open) ── */
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={launcherRef}
              id="cafa-ai-launcher"
              type="button"
              onClick={() => open ? setOpen(false) : (setOpen(true), setMinimized(false))}
              aria-label={open ? t("widget.closeAssistant") : t("widget.openAssistant")}
              aria-expanded={open}
              aria-controls="cafa-ai-panel"
              className={cn(
                "fixed z-50 h-12 w-12 rounded-full flex items-center justify-center",
                enabled
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-slate-600 text-white hover:bg-slate-700",
                "shadow-md hover:shadow-lg",
                "transition-all duration-150 motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
              style={{ bottom: launcherBottomStyle, right: "1.5rem" }}
            >
              {open
                ? <X className="h-5 w-5" aria-hidden="true" />
                : <Bot className="h-5 w-5" aria-hidden="true" />
              }
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={10} className="text-xs font-medium">
            {open ? t("widget.close") : t("widget.openAssistant")}
          </TooltipContent>
        </Tooltip>
      )}

      {/* ── Chat panel — positioned directly above the launcher ── */}
      {open && (
        <div
          id="cafa-ai-panel"
          role="dialog"
          aria-label={t("widget.assistantName")}
          className={cn(
             embedded ? "relative w-full flex flex-col" : "fixed z-50 flex flex-col",
            // Surface — use design tokens
            "bg-card border border-border",
            // Shape
            "rounded-2xl",
            // Shadow — restrained enterprise quality
            "shadow-xl",
            // Width: 380–420px, full-width on small screens
             !embedded && "w-[calc(100vw-3rem)] max-w-[400px]",
            // Smooth transitions
            "transition-all duration-200 motion-reduce:transition-none",
          )}
          style={embedded
            ? { maxHeight: minimized ? "56px" : "min(70vh, 700px)", overflow: "hidden" }
            : {
                bottom: panelBottomStyle,
                right: "1.5rem",
                maxHeight: minimized ? "56px" : "min(75vh, calc(100dvh - 120px))",
                overflow: "hidden",
              }}
        >
          {/* ── Panel header — 52–56px, compact ── */}
          <div
            className={cn(
              "flex items-center gap-2.5 px-4 py-3 shrink-0 rounded-t-2xl cursor-pointer select-none",
              enabled ? "bg-primary text-primary-foreground" : "bg-slate-700 text-white",
            )}
            style={{ minHeight: "54px" }}
            onClick={() => minimized && setMinimized(false)}
          >
            {/* CAFA AI icon */}
            <div className="h-7 w-7 rounded-full bg-white/15 flex items-center justify-center shrink-0" aria-hidden="true">
              <Bot className="h-4 w-4" />
            </div>

            {/* Title + status */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-none tracking-tight">{t("widget.assistantName")}</p>
              {!minimized && (
                <p className="text-[11px] text-primary-foreground/65 mt-0.5 leading-none">
                  {enabled ? t("widget.readyToAssist") : t("widget.pendingActivation")}
                </p>
              )}
            </div>

            {/* Header actions — right-aligned */}
            <div className="flex items-center gap-0.5 shrink-0">
              {!minimized && enabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); clearHistory(); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors motion-reduce:transition-none"
                  title={t("widget.clearHistory")}
                  aria-label={t("widget.clearHistory")}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              {!embedded && !minimized && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors motion-reduce:transition-none"
                  title={t("widget.minimise")}
                  aria-label={t("widget.minimisePanel")}
                >
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* ── Panel body — hidden when minimised ── */}
          {!minimized && (
            <>
              {/* UAT / disabled info state */}
              {!enabled && (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
                    <Bot className="h-7 w-7 text-amber-500" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">
                      {t("widget.readyForConfiguration")}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{uatMessage}</p>
                  </div>
                  {isAdminRole && (
                    <div className="w-full rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-700 text-start space-y-1">
                      <p className="font-semibold">{t("widget.activateHeading")}</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-amber-600">
                        <li>
                          <Trans i18nKey="widget.activateStepEnv" t={t}>
                            Set <code className="bg-amber-100 px-1 rounded">AI_ENABLED=true</code> in environment
                          </Trans>
                        </li>
                        <li>{t("widget.activateStepProvision")}</li>
                        <li>
                          <Trans i18nKey="widget.activateStepEnable" t={t}>
                            Enable it in <strong>AI → Administration</strong>
                          </Trans>
                        </li>
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {/* Normal chat UI */}
              {enabled && (
                <>
                  {/* Messages — scrolls independently */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                    {messages.map(msg => (
                      <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                        {msg.role === "assistant" && (
                          <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5 me-2" aria-hidden="true">
                            <Bot className="h-3.5 w-3.5 text-primary-foreground" />
                          </div>
                        )}
                        <div className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted border border-border/50 text-foreground rounded-bl-sm",
                        )}>
                          {msg.role === "assistant" ? (
                            <div className="prose prose-sm prose-gray max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mt-1 [&>ul]:mb-2 [&>ol]:mt-1 [&>ol]:mb-2 [&>ul>li]:text-sm [&>ol>li]:text-sm">
                              {msg.content ? (
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              ) : (
                                <span className="flex gap-1 items-center text-muted-foreground" aria-label={t("widget.generatingResponse")}>
                                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce motion-reduce:animate-none [animation-delay:0ms]" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce motion-reduce:animate-none [animation-delay:150ms]" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce motion-reduce:animate-none [animation-delay:300ms]" />
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Quick prompts — shown only before user has sent a message */}
                  {messages.length <= 1 && (
                    <div className="px-4 pb-2 shrink-0">
                      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider mb-2 font-medium">{t("widget.quickQuestions")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_PROMPT_KEYS.slice(0, 4).map(key => {
                          const prompt = t(`widget.prompts.${key}`);
                          return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => sendMessage(prompt)}
                            className="text-xs px-2.5 py-1 bg-primary/5 text-primary border border-primary/15 rounded-full hover:bg-primary/10 transition-colors motion-reduce:transition-none leading-none whitespace-nowrap"
                          >
                            {prompt}
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Composer */}
                  <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
                    <div className="flex gap-2 items-end bg-muted/50 border border-border rounded-xl px-3 py-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/20 transition-all motion-reduce:transition-none">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t("widget.messagePlaceholder")}
                        rows={1}
                        aria-label={t("widget.messageInput")}
                        className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none max-h-24 leading-relaxed"
                        style={{ overflowY: input.split("\n").length > 3 ? "auto" : "hidden" }}
                        disabled={streaming}
                      />
                      {streaming ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={stop}
                          aria-label={t("widget.stopGenerating")}
                          className="h-7 w-7 p-0 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => sendMessage(input)}
                          disabled={!input.trim()}
                          aria-label={t("widget.sendMessage")}
                          className="h-7 w-7 p-0 shrink-0 bg-primary hover:bg-primary/90 rounded-lg"
                        >
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/45 text-center mt-1.5">
                      {t("widget.internalUse", { page: location })}
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
