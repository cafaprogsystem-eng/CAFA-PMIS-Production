import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell, Camera, CheckCircle2, Eye, EyeOff, Loader2, Lock, Save,
  Settings, Shield, Trash2, Upload, User,
} from "lucide-react";
import {
  getGetProfileQueryKey,
  useChangePassword,
  useCompleteProfilePhotoUpload,
  useGetProfile,
  useRemoveProfilePhoto,
  useRequestProfilePhotoUploadUrl,
  useUpdateProfile,
  type ProfilePhotoUploadRequestContentType,
  type UserProfile,
} from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/language-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { formatDateInTimezone } from "@/lib/format";

const TIMEZONES = [
  "Africa/Khartoum", "Africa/Juba", "Africa/Cairo", "Africa/Nairobi",
  "Africa/Addis_Ababa", "Africa/Lagos", "Europe/London", "Europe/Berlin",
  "Asia/Dubai", "America/New_York", "America/Los_Angeles", "UTC",
] as const;

const PHOTO_TYPES = new Set<ProfilePhotoUploadRequestContentType>(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

function passwordRules(password: string): Record<"length" | "letter" | "number", boolean> {
  return {
    length: password.length >= 10,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password),
  };
}

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { error?: string } } | undefined)?.data?.error;
}

export default function ProfilePage() {
  const { t } = useTranslation(["settings", "common"]);
  const { setLang } = useLanguage();
  const queryClient = useQueryClient();
  const { data: profile, isLoading, isError, refetch } = useGetProfile();
  const { mutateAsync: saveProfile } = useUpdateProfile();
  const { mutateAsync: changePassword } = useChangePassword();
  const { mutateAsync: requestPhotoUpload } = useRequestProfilePhotoUploadUrl();
  const { mutateAsync: completePhotoUpload } = useCompleteProfilePhotoUpload();
  const { mutateAsync: removePhoto } = useRemoveProfilePhoto();

  const fileRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [timezone, setTimezone] = useState("Africa/Khartoum");
  const [savingSettings, setSavingSettings] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setPhone(profile.phone ?? "");
    setJobTitle(profile.jobTitle ?? "");
    setLanguage(profile.languagePreference === "ar" ? "ar" : "en");
    setTimezone(profile.timezone ?? "Africa/Khartoum");
  }, [profile]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const personalDirty = profile ? (
    name !== (profile.name ?? "") ||
    phone !== (profile.phone ?? "") ||
    jobTitle !== (profile.jobTitle ?? "")
  ) : false;
  const settingsDirty = profile ? (
    language !== (profile.languagePreference === "ar" ? "ar" : "en") ||
    timezone !== (profile.timezone ?? "Africa/Khartoum")
  ) : false;
  const passwordPolicy = passwordRules(newPassword);
  const passwordMatches = confirmPassword.length > 0 && confirmPassword === newPassword;
  const passwordValid = Object.values(passwordPolicy).every(Boolean) && passwordMatches;
  const photoSrc = previewUrl ?? profile?.avatarUrl ?? undefined;
  const initials = (profile?.name ?? "??").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const access = profile?.access;

  const updateProfileCache = (next: UserProfile) => {
    queryClient.setQueryData(getGetProfileQueryKey(), next);
  };

  const onPhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type as ProfilePhotoUploadRequestContentType)) {
      toast.error(t("profile.invalidFileType"));
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      toast.error(t("profile.fileTooLarge"));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const savePhoto = async () => {
    if (!photoFile) return;
    setUploadingPhoto(true);
    try {
      const descriptor = await requestPhotoUpload({
        data: { size: photoFile.size, contentType: photoFile.type as ProfilePhotoUploadRequestContentType },
      });
      const upload = await fetch(descriptor.uploadURL, {
        method: "PUT",
        body: photoFile,
        headers: { "Content-Type": photoFile.type },
      });
      if (!upload.ok) throw new Error("photo_upload_failed");
      const result = await completePhotoUpload({ data: { uploadToken: descriptor.uploadToken } });
      updateProfileCache({ ...profile!, avatarUrl: result.avatarUrl });
      setPhotoFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      toast.success(t("profile.photoUpdated"));
    } catch {
      toast.error(t("profile.photoUpdateError"));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const deletePhoto = async () => {
    setRemovingPhoto(true);
    try {
      const result = await removePhoto();
      updateProfileCache({ ...profile!, avatarUrl: result.avatarUrl });
      setPhotoFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      toast.success(t("profile.photoRemoved"));
    } catch {
      toast.error(t("profile.photoRemoveError"));
    } finally {
      setRemovingPhoto(false);
    }
  };

  const savePersonal = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error(t("profile.nameRequired"));
      return;
    }
    setSavingPersonal(true);
    try {
      const result = await saveProfile({ data: { name, phone: phone || null, jobTitle: jobTitle || null } });
      updateProfileCache(result);
      toast.success(t("profile.saveSuccess"));
    } catch (error) {
      const code = errorCode(error);
      toast.error(code === "invalid_phone" ? t("profile.invalidPhone") : t("profile.saveError"));
    } finally {
      setSavingPersonal(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const result = await saveProfile({ data: { languagePreference: language, timezone } });
      updateProfileCache(result);
      setLang(language);
      toast.success(t("profile.accountSettingsSaved"));
    } catch {
      toast.error(t("profile.accountSettingsError"));
    } finally {
      setSavingSettings(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordValid) return;
    setChangingPassword(true);
    try {
      await changePassword({ data: { currentPassword, newPassword } });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast.success(t("profile.passwordChanged"));
    } catch (error) {
      const code = errorCode(error);
      if (code === "incorrect_password") toast.error(t("profile.incorrectPassword"));
      else if (code === "no_password_set") toast.error(t("profile.noPasswordSet"));
      else if (code === "too_many_requests") toast.error(t("profile.passwordThrottled"));
      else toast.error(t("profile.changePasswordError"));
    } finally {
      setChangingPassword(false);
    }
  };

  const accessDetails = useMemo(() => {
    if (!access) return t("profile.accessNotAssigned");
    if (access.kind === "organisation_wide") return t("profile.accessOrganisationWide");
    if (access.kind === "state_scoped") return access.stateNames.join(", ");
    if (access.kind === "sector_scoped") return access.sectors.join(", ");
    return t("profile.accessNotAssigned");
  }, [access, t]);

  if (isLoading) return <ProfileLoading />;
  if (isError) {
    return <ErrorState variant="server" title={t("profile.loadError")} description={t("profile.loadErrorDesc")} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-medium tracking-tight">
          <User className="h-7 w-7 text-primary" /> {t("profile.pageTitle")}
        </h1>
        <p className="mt-1 text-muted-foreground">{t("profile.pageSubtitle")}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <aside className="space-y-4">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
              <Avatar className="h-28 w-28 ring-4 ring-background shadow-lg">
                {photoSrc && <AvatarImage src={photoSrc} alt={profile?.name ?? ""} className="object-cover" />}
                <AvatarFallback className="bg-sidebar-primary text-3xl text-sidebar-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPhotoSelected} />
              <div className="w-full space-y-2">
                {photoFile ? (
                  <>
                    <Button size="sm" className="w-full gap-1.5" onClick={savePhoto} disabled={uploadingPhoto}>
                      {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {uploadingPhoto ? t("profile.uploadingPhoto") : t("profile.savePhoto")}
                    </Button>
                    <Button size="sm" variant="ghost" className="w-full" onClick={() => { setPhotoFile(null); setPreviewUrl(null); }}>
                      {t("common:cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => fileRef.current?.click()}>
                      <Camera className="h-3.5 w-3.5" /> {t("profile.changePhoto")}
                    </Button>
                    {profile?.avatarUrl && (
                      <Button size="sm" variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={deletePhoto} disabled={removingPhoto}>
                        {removingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        {t("profile.removePhoto")}
                      </Button>
                    )}
                  </>
                )}
                <p className="text-xs text-muted-foreground">{t("profile.photoFormat")}</p>
              </div>
              <div className="space-y-1">
                <p className="text-lg font-medium leading-tight">{profile?.name}</p>
                <p className="text-sm text-muted-foreground">{profile?.jobTitle || t("profile.noJobTitle")}</p>
                <p className="text-xs text-muted-foreground"><bdi dir="ltr">{profile?.email}</bdi></p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 border-t pt-4 text-start">
                <Metadata label={t("profile.memberSince")} value={formatDateInTimezone(profile?.createdAt, timezone, false)} dir="ltr" />
                <Metadata label={t("profile.lastLogin")} value={formatDateInTimezone(profile?.lastLoginAt, timezone)} dir="ltr" />
                <Metadata label={t("profile.username")} value={profile?.username ?? "—"} mono />
                <Metadata label={t("profile.timezone")} value={timezone} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4 text-muted-foreground" />{t("profile.organisationAccess")}</CardTitle>
              <CardDescription>{t("profile.organisationAccessDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Metadata label={t("profile.systemRole")} value={profile?.roleLabel ?? "—"} />
              <Metadata label={t("profile.accessScope")} value={accessDetails} />
              <Metadata label={t("profile.accountStatus")} value={t(`profile.status.${profile?.status ?? "inactive"}`)} />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("profile.emailVerification")}</p>
                <Badge variant={profile?.emailVerified ? "default" : "outline"} className="mt-1">
                  {profile?.emailVerified ? t("profile.verified") : t("profile.notVerified")}
                </Badge>
              </div>
              <p className="border-t pt-3 text-xs text-muted-foreground">{t("profile.assignmentAdminNotice")}</p>
            </CardContent>
          </Card>
        </aside>

        <main className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4 text-muted-foreground" />{t("profile.personalInfo")}</CardTitle>
              <CardDescription>{t("profile.personalInfoDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" noValidate onSubmit={savePersonal}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("profile.fullNameLabel")} htmlFor="profile-name" required>
                    <Input id="profile-name" maxLength={150} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!name.trim()} />
                  </Field>
                  <Field label={t("profile.jobTitle")} htmlFor="profile-job">
                    <Input id="profile-job" maxLength={120} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder={t("profile.jobTitlePlaceholder")} />
                  </Field>
                </div>
                <Field label={t("profile.phoneLabel")} htmlFor="profile-phone">
                  <Input id="profile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t("profile.phonePlaceholder")} />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" className="gap-1.5" disabled={!personalDirty || savingPersonal || !name.trim()}>
                    {savingPersonal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {savingPersonal ? t("profile.saving") : t("profile.saveChanges")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Settings className="h-4 w-4 text-muted-foreground" />{t("profile.accountSettings")}</CardTitle>
              <CardDescription>{t("profile.accountSettingsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("profile.interfaceLanguage")} htmlFor="profile-language">
                  <Select value={language} onValueChange={(value) => setLanguage(value === "ar" ? "ar" : "en")}>
                    <SelectTrigger id="profile-language"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("common:english")}</SelectItem>
                      <SelectItem value="ar">{t("common:arabic")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("profile.timezone")} htmlFor="profile-timezone">
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger id="profile-timezone"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((value) => <SelectItem key={value} value={value}>{t(`profile.timezones.${value.replace("/", "_")}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex justify-end">
                <Button size="sm" className="gap-1.5" onClick={saveSettings} disabled={!settingsDirty || savingSettings}>
                  {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {savingSettings ? t("profile.saving") : t("profile.saveSettings")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-muted-foreground" />{t("profile.notifPreferences")}</CardTitle>
              <CardDescription>{t("profile.notifPreferencesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">{t("profile.notifPreferencesHint")}</p>
              <Link href="/notification-preferences"><Button variant="outline" size="sm" className="gap-1.5"><Bell className="h-3.5 w-3.5" />{t("profile.manageNotifPreferences")}</Button></Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4 text-muted-foreground" />{t("profile.changePassword")}</CardTitle>
              <CardDescription>{t("profile.changePasswordDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" noValidate onSubmit={submitPassword}>
                <PasswordField id="profile-current-password" label={t("profile.currentPassword")} value={currentPassword} onChange={setCurrentPassword} visible={showCurrent} onToggle={() => setShowCurrent((value) => !value)} showLabel={t("profile.showPassword")} hideLabel={t("profile.hidePassword")} />
                <PasswordField id="profile-new-password" label={t("profile.newPassword")} value={newPassword} onChange={setNewPassword} visible={showNew} onToggle={() => setShowNew((value) => !value)} showLabel={t("profile.showPassword")} hideLabel={t("profile.hidePassword")} />
                {newPassword && <div className="flex flex-wrap gap-x-4 gap-y-1" aria-live="polite">
                  {(["length", "letter", "number"] as const).map((rule) => <p key={rule} className={`flex items-center gap-1 text-xs ${passwordPolicy[rule] ? "text-success" : "text-muted-foreground"}`}>
                    <CheckCircle2 className="h-3 w-3" />{t(`profile.passwordRule.${rule}`)}
                  </p>)}
                </div>}
                <PasswordField id="profile-confirm-password" label={t("profile.confirmNewPassword")} value={confirmPassword} onChange={setConfirmPassword} visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} showLabel={t("profile.showPassword")} hideLabel={t("profile.hidePassword")} invalid={confirmPassword.length > 0 && !passwordMatches} error={confirmPassword.length > 0 && !passwordMatches ? t("profile.passwordMismatch") : undefined} />
                <div className="flex justify-end">
                  <Button type="submit" variant="destructive" size="sm" className="gap-1.5" disabled={changingPassword || !currentPassword || !passwordValid}>
                    {changingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                    {changingPassword ? t("profile.changingPassword") : t("profile.changePasswordBtn")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children, required = false }: { label: string; htmlFor: string; children: ReactNode; required?: boolean }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}{required && <span className="text-destructive"> *</span>}</Label>{children}</div>;
}

function Metadata({ label, value, mono = false, dir }: { label: string; value: string; mono?: boolean; dir?: "ltr" | "rtl" }) {
  return <div><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-0.5 text-sm ${mono ? "font-mono" : ""}`}><bdi dir={dir}>{value}</bdi></p></div>;
}

function PasswordField({ id, label, value, onChange, visible, onToggle, showLabel, hideLabel, invalid, error }: {
  id: string; label: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; showLabel: string; hideLabel: string; invalid?: boolean; error?: string;
}) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <div className="relative">
      <Lock className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} className={`ps-9 pe-10 ${invalid ? "border-destructive" : ""}`} aria-invalid={invalid} aria-describedby={error ? `${id}-error` : undefined} autoComplete={id.includes("current") ? "current-password" : "new-password"} />
      <button type="button" onClick={onToggle} aria-label={visible ? hideLabel : showLabel} aria-pressed={visible} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
    {error && <p id={`${id}-error`} className="text-xs text-destructive" role="alert">{error}</p>}
  </div>;
}

function ProfileLoading() {
  return <div className="space-y-6"><Skeleton className="h-10 w-48" /><div className="grid gap-6 lg:grid-cols-3"><div className="space-y-4"><Skeleton className="h-[460px]" /><Skeleton className="h-64" /></div><div className="space-y-4 lg:col-span-2"><Skeleton className="h-64" /><Skeleton className="h-48" /><Skeleton className="h-40" /><Skeleton className="h-96" /></div></div></div>;
}