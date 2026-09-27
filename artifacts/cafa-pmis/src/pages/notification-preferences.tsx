import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, Mail, Settings2, Lock, Save, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import type { ReactNode } from "react";
import {
  Alert, Button, Card, Chip, Input, Label, Radio, RadioGroup, Separator, Skeleton, Switch, Tabs, TextField,
} from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetProfile, useUpdateProfile, useGetMe, getGetProfileQueryKey, type UserProfile } from "@workspace/api-client-react";

// ── Preferences type ──────────────────────────────────────────────────────────

interface NotifPrefs {
  inApp: {
    approvals: boolean;
    approvalDecisions: boolean;
    comments: boolean;
    assignments: boolean;
    mentions: boolean;
    dueDates: boolean;
    overdueItems: boolean;
    highRisks: boolean;
    criticalRisks: boolean;
    systemNotifications: boolean;
  };
  email: {
    approvalRequests: boolean;
    approvalDecisions: boolean;
    assignments: boolean;
    mentions: boolean;
    passwordReset: boolean;
    userInvitations: boolean;
    dueDateReminders: boolean;
    highRisks: boolean;
    criticalRisks: boolean;
  };
  deliveryOption: "inapp_only" | "email_only" | "both";
  digest: "immediate";
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    // timezone is NOT stored in the draft; it is derived from profile.timezone on save
  };
}

const DEFAULT: NotifPrefs = {
  inApp: {
    approvals: true,
    approvalDecisions: true,
    comments: true,
    assignments: true,
    mentions: true,
    dueDates: true,
    overdueItems: true,
    highRisks: true,
    criticalRisks: true,
    systemNotifications: true,
  },
  email: {
    approvalRequests: false,
    approvalDecisions: false,
    assignments: true,
    mentions: true,
    passwordReset: true,
    userInvitations: true,
    dueDateReminders: false,
    highRisks: true,
    criticalRisks: true,
  },
  deliveryOption: "both",
  digest: "immediate",
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

const INAPP_ITEMS: { key: keyof NotifPrefs["inApp"]; mandatory?: boolean }[] = [
  { key: "approvals" },
  { key: "approvalDecisions" },
  { key: "comments" },
  { key: "assignments" },
  { key: "mentions" },
  { key: "dueDates" },
  { key: "overdueItems" },
  { key: "highRisks" },
  { key: "criticalRisks", mandatory: true },
  { key: "systemNotifications" },
];

/**
 * Base email preference items. userInvitations is hidden unless the current
 * user holds the users.manage permission (invite-management capability).
 */
const EMAIL_ITEMS_BASE: { key: keyof NotifPrefs["email"]; mandatory?: boolean; requiresInvitePerm?: boolean }[] = [
  { key: "approvalRequests" },
  { key: "approvalDecisions" },
  { key: "assignments" },
  { key: "mentions" },
  { key: "dueDateReminders" },
  { key: "highRisks" },
  { key: "criticalRisks", mandatory: true },
  { key: "userInvitations", requiresInvitePerm: true },
  { key: "passwordReset", mandatory: true },
];

/** Returns a human-readable timezone label, e.g. "Africa/Khartoum (UTC+03:00)". */
function formatTimezoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const gmtStr = parts.find(p => p.type === "timeZoneName")?.value ?? "";
    const utcStr = gmtStr.replace(/^GMT/, "UTC");
    return `${tz} (${utcStr})`;
  } catch {
    return tz;
  }
}

// ── Building blocks ───────────────────────────────────────────────────────────

function RequiredChip({ label }: { label: string }) {
  return (
    <Chip size="sm" color="warning" variant="soft" className="h-5 gap-0.5 px-1.5 text-xs">
      <Lock className="h-2.5 w-2.5" aria-hidden="true" /> {label}
    </Chip>
  );
}

/** One labelled on/off preference; the visible label also names the switch. */
function PreferenceSwitch({
  label, isSelected, onChange, isDisabled,
}: { label: string; isSelected: boolean; onChange: (value: boolean) => void; isDisabled?: boolean }) {
  return (
    <Switch isSelected={isSelected} onChange={onChange} isDisabled={isDisabled} aria-label={label}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

function RadioRow({
  value, label, description, badge, isDisabled,
}: { value: string; label: string; description: string; badge?: ReactNode; isDisabled?: boolean }) {
  return (
    <Radio value={value} isDisabled={isDisabled} className="px-3 py-2.5">
      <Radio.Content>
        <Radio.Control>
          <Radio.Indicator />
        </Radio.Control>
        <Label>
          <span className="font-medium">{label}</span>
          {badge && <span className="ms-2 inline-flex align-middle">{badge}</span>}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{description}</span>
        </Label>
      </Radio.Content>
    </Radio>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NotificationPreferencesPage() {
  const { t, i18n } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetProfile();
  const { data: meData } = useGetMe();
  const { mutateAsync: saveProfile } = useUpdateProfile();

  const [prefs, setPrefs] = useState<NotifPrefs>({ ...DEFAULT });
  /** Snapshot of the last successfully loaded or saved preferences for dirty detection. */
  const [snapshot, setSnapshot] = useState<NotifPrefs>({ ...DEFAULT });
  const [saving, setSaving] = useState(false);
  /**
   * Set to true immediately before writing the saved profile into the React Query
   * cache. The profile effect checks this flag so it can refresh the snapshot
   * without overwriting any edits the user made since the in-flight save started.
   */
  const justSavedRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    const saved = profile.notificationPreferences as Partial<NotifPrefs> | null;
    const loaded: NotifPrefs = saved && typeof saved === "object"
      ? {
          ...DEFAULT,
          ...saved,
          inApp: { ...DEFAULT.inApp, ...(saved.inApp ?? {}) },
          email: { ...DEFAULT.email, ...(saved.email ?? {}) },
          quietHours: { ...DEFAULT.quietHours, ...(saved.quietHours ?? {}) },
          // Daily and weekly values may exist in legacy rows but cannot be
          // selected or persisted until a digest scheduler is available.
          digest: "immediate",
        }
      : { ...DEFAULT };
    if (justSavedRef.current) {
      // Profile update was triggered by our own PATCH — sync the snapshot to
      // the server-normalised value but do NOT overwrite the live draft, which
      // may already contain further changes made while the save was in flight.
      justSavedRef.current = false;
      setSnapshot(loaded);
      return;
    }
    setPrefs(loaded);
    setSnapshot(loaded);
  }, [profile]);

  /** True only when the current draft differs from the last saved snapshot. */
  const isDirty = useMemo(
    () => JSON.stringify(prefs) !== JSON.stringify(snapshot),
    [prefs, snapshot],
  );

  // Permissions — gate Invitations row behind invite-management capability.
  // Honour the wildcard "*" granted to super_admin (matches hasPerm server-side).
  const permissions: string[] = meData?.permissions ?? [];
  const canManageUsers = permissions.includes("*") || permissions.includes("users.manage");

  // Email verification — optional switches become non-interactive when unverified
  const emailVerified = profile?.emailVerified !== false; // null/undefined treated as verified

  // Email items filtered by RBAC
  const EMAIL_ITEMS = EMAIL_ITEMS_BASE.filter(
    item => !item.requiresInvitePerm || canManageUsers,
  );

  // Profile timezone for quiet hours — read-only display; injected on save
  const profileTimezone = (profile as { timezone?: string } | null)?.timezone ?? "Africa/Khartoum";

  const setInApp = (key: keyof NotifPrefs["inApp"], val: boolean) => {
    if (INAPP_ITEMS.find(i => i.key === key)?.mandatory) return;
    setPrefs(p => ({ ...p, inApp: { ...p.inApp, [key]: val } }));
  };

  const setEmail = (key: keyof NotifPrefs["email"], val: boolean) => {
    if (EMAIL_ITEMS_BASE.find(i => i.key === key)?.mandatory) return;
    // Defensive guard: unverified users cannot change optional email preferences
    // even if they somehow bypass the UI (e.g. via assistive technology).
    if (!emailVerified) return;
    setPrefs(p => ({ ...p, email: { ...p.email, [key]: val } }));
  };

  const handleSave = async () => {
    setSaving(true);
    // Inject the profile timezone so quietHours.timezone is always authoritative
    // from the user's profile; the draft does not store a separate copy.
    const prefsToSave = {
      ...prefs,
      quietHours: { ...prefs.quietHours, timezone: profileTimezone },
    };
    try {
      const savedProfile = await saveProfile({ data: { notificationPreferences: prefsToSave as unknown as Record<string, unknown> } });
      // Mark that the next profile effect run is ours — it should update the
      // snapshot (server may normalise mandatory flags) without resetting the live draft.
      justSavedRef.current = true;
      // Write the PATCH response into the React Query cache so navigation away
      // and back always shows the saved state, not stale pre-save data.
      queryClient.setQueryData(getGetProfileQueryKey(), savedProfile as UserProfile);
      // Also update snapshot from our local draft for immediate dirty tracking.
      setSnapshot(prefs);
      toast.success(t("preferencesSaved"));
    } catch {
      // On failure the draft is preserved unchanged; snapshot is not updated
      toast.error(t("preferencesSaveError"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="space-y-1"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-80" /></div>
        <div className="flex gap-1"><Skeleton className="h-9 flex-1 rounded-md" /><Skeleton className="h-9 flex-1 rounded-md" /><Skeleton className="h-9 flex-1 rounded-md" /></div>
        <div className="rounded-xl border overflow-hidden">
          <div className="px-5 py-4 border-b space-y-1"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" /></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b last:border-0">
              <div className="space-y-1"><Skeleton className="h-4 w-44" /><Skeleton className="h-3 w-56" /></div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div dir={i18n.dir()} className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Link href="/profile" className="hover:text-foreground transition-colors">{t("myProfile")}</Link>
        <ChevronRight className="h-3 w-3 rtl:rotate-180" />
        <span className="text-foreground font-medium">{t("preferences.title")}</span>
      </div>
      <div>
        <h1 className="text-foreground text-xl font-semibold flex items-center gap-2">
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" /> {t("preferences.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t("preferencesSubtitle")}
        </p>
      </div>

      <Tabs defaultSelectedKey="inapp">
        <Tabs.ListContainer className="w-full">
          <Tabs.List aria-label={t("preferences.title")} className="grid w-full grid-cols-3">
            <Tabs.Tab id="inapp" className="flex h-8 items-center gap-1.5 px-2 text-xs sm:text-sm">
              <Bell className="h-3.5 w-3.5" aria-hidden="true" /> {t("tabInApp")}<Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="email" className="flex h-8 items-center gap-1.5 px-2 text-xs sm:text-sm">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {t("tabEmail")}<Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="delivery" className="flex h-8 items-center gap-1.5 px-2 text-xs sm:text-sm">
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("tabDelivery")}<Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        {/* ── In-App Tab ── */}
        <Tabs.Panel id="inapp" className="mt-3">
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("preferences.inAppNotifications")}</Card.Title>
              <Card.Description>{t("inAppDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-0">
              {INAPP_ITEMS.map(({ key, mandatory }, i) => (
                <div key={key}>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <div className="flex-1 pe-4">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{t(`preferences.inAppItems.${key}.label`)}</p>
                        {mandatory && <RequiredChip label={t("required")} />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{t(`preferences.inAppItems.${key}.description`)}</p>
                    </div>
                    <PreferenceSwitch
                      label={t(`preferences.inAppItems.${key}.label`)}
                      isSelected={prefs.inApp[key]}
                      onChange={v => setInApp(key, v)}
                      isDisabled={mandatory}
                    />
                  </div>
                  {i < INAPP_ITEMS.length - 1 && <Separator />}
                </div>
              ))}
            </Card.Content>
          </Card>
        </Tabs.Panel>

        {/* ── Email Tab ── */}
        <Tabs.Panel id="email" className="mt-3 space-y-3">
          {/* Email verification banner — shown when the user's address is unverified */}
          {!emailVerified && (
            <Alert status="warning">
              <Alert.Indicator><AlertCircle className="h-4 w-4" aria-hidden="true" /></Alert.Indicator>
              <Alert.Content>
                <Alert.Title>{t("emailVerificationRequired")}</Alert.Title>
              </Alert.Content>
            </Alert>
          )}
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("preferences.emailNotifications")}</Card.Title>
              <Card.Description>{t("emailDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-0">
              {EMAIL_ITEMS.map(({ key, mandatory }, i) => {
                // Optional switches are fully disabled when email is unverified;
                // mandatory security switches are always interactive (Required badge).
                const optionalDisabled = !emailVerified && !mandatory;
                const isDisabled = mandatory || optionalDisabled;
                return (
                  <div key={key}>
                    <div
                      className={`flex items-center justify-between gap-4 py-2.5${optionalDisabled ? " opacity-50" : ""}`}
                    >
                      <div className="flex-1 pe-4">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{t(`preferences.emailItems.${key}.label`)}</p>
                          {mandatory && <RequiredChip label={t("required")} />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{t(`preferences.emailItems.${key}.description`)}</p>
                      </div>
                      <PreferenceSwitch
                        label={t(`preferences.emailItems.${key}.label`)}
                        isSelected={prefs.email[key]}
                        onChange={v => setEmail(key, v)}
                        isDisabled={isDisabled}
                      />
                    </div>
                    {i < EMAIL_ITEMS.length - 1 && <Separator />}
                  </div>
                );
              })}
            </Card.Content>
          </Card>
        </Tabs.Panel>

        {/* ── Delivery Tab ── */}
        <Tabs.Panel id="delivery" className="mt-3 space-y-3">
          {/* Delivery Option */}
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("deliveryChannel")}</Card.Title>
              <Card.Description>{t("deliveryChannelDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              <RadioGroup
                aria-label={t("deliveryChannel")}
                value={prefs.deliveryOption}
                onChange={v => setPrefs(p => ({ ...p, deliveryOption: v as NotifPrefs["deliveryOption"] }))}
                className="gap-0 divide-y rounded-md border"
              >
                <RadioRow value="both" label={t("deliveryBoth")} description={t("deliveryBothDesc")} />
                <RadioRow value="inapp_only" label={t("deliveryInAppOnly")} description={t("deliveryInAppOnlyDesc")} />
                <RadioRow value="email_only" label={t("deliveryEmailOnly")} description={t("deliveryEmailOnlyDesc")} />
              </RadioGroup>
            </Card.Content>
          </Card>

          {/* Digest */}
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("digestTitle")}</Card.Title>
              <Card.Description>{t("digestDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              <RadioGroup
                aria-label={t("digestTitle")}
                value={prefs.digest}
                onChange={v => setPrefs(p => ({ ...p, digest: v as NotifPrefs["digest"] }))}
                className="gap-0 divide-y rounded-md border"
              >
                <RadioRow value="immediate" label={t("digestImmediate")} description={t("digestImmediateDesc")} />
                <RadioRow
                  value="daily" isDisabled label={t("digestDaily")} description={t("digestDailyDesc")}
                  badge={<Chip size="sm" variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">{t("comingSoon")}</Chip>}
                />
                <RadioRow
                  value="weekly" isDisabled label={t("digestWeekly")} description={t("digestWeeklyDesc")}
                  badge={<Chip size="sm" variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">{t("comingSoon")}</Chip>}
                />
              </RadioGroup>
            </Card.Content>
          </Card>

          {/* Quiet Hours */}
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("quietHoursTitle")}</Card.Title>
              <Card.Description>{t("quietHoursDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t("quietHoursEnable")}</p>
                  <p className="text-xs text-muted-foreground">{t("quietHoursEnableDesc")}</p>
                </div>
                <PreferenceSwitch
                  label={t("quietHoursEnable")}
                  isSelected={prefs.quietHours.enabled}
                  onChange={v => setPrefs(p => ({ ...p, quietHours: { ...p.quietHours, enabled: v } }))}
                />
              </div>
              {prefs.quietHours.enabled && (
                <>
                  <Separator />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextField
                      value={prefs.quietHours.start}
                      onChange={v => setPrefs(p => ({ ...p, quietHours: { ...p.quietHours, start: v } }))}
                      fullWidth
                    >
                      <Label>{t("quietHoursStart")}</Label>
                      <Input id="qh-start" type="time" />
                    </TextField>
                    <TextField
                      value={prefs.quietHours.end}
                      onChange={v => setPrefs(p => ({ ...p, quietHours: { ...p.quietHours, end: v } }))}
                      fullWidth
                    >
                      <Label>{t("quietHoursEnd")}</Label>
                      <Input id="qh-end" type="time" />
                    </TextField>
                  </div>
                  {/* Timezone is derived from the user's profile — displayed read-only */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("quietHoursTimezone")}</p>
                    <p
                      className="text-sm text-muted-foreground rounded-md border border-input bg-muted/40 px-3 py-2"
                      aria-label={t("quietHoursTimezoneReadOnly")}
                      data-testid="qh-timezone-readonly"
                    >
                      {formatTimezoneLabel(profileTimezone)}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("quietHoursTimezoneReadOnly")}</p>
                  </div>
                </>
              )}
            </Card.Content>
          </Card>
        </Tabs.Panel>
      </Tabs>

      {/* Save button — disabled until a real change has been made */}
      <div className="flex justify-end border-t pt-1">
        <Button onPress={handleSave} isDisabled={!isDirty || saving} isPending={saving} className="h-9">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t("saving") : t("savePreferences")}
        </Button>
      </div>
    </div>
  );
}
