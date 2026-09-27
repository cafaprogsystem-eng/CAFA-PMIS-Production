import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell, Camera, CheckCircle2, Loader2, Lock, Save,
  Settings, Shield, Trash2, Upload, User,
} from "@/components/icons";
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
import { Avatar, Button, Card, Chip, Input, Label, Skeleton, TextField } from "@heroui/react";
import { ErrorState } from "@/components/ui/error-state";
import { PasswordField } from "@/components/password-field";
import { SelectField } from "@/components/select-field";
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
        <h1 className="text-foreground text-xl font-semibold flex items-center gap-2">
          <User className="size-5 text-primary" /> {t("profile.pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("profile.pageSubtitle")}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <aside className="space-y-4">
          <Card>
            <Card.Content className="flex flex-col items-center gap-4 pt-2 text-center">
              <Avatar className="size-28 text-3xl" color="accent" variant="soft">
                {photoSrc && <Avatar.Image src={photoSrc} alt={profile?.name ?? ""} className="object-cover" />}
                <Avatar.Fallback className="text-3xl font-semibold">{initials}</Avatar.Fallback>
              </Avatar>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPhotoSelected} />
              <div className="w-full space-y-2">
                {photoFile ? (
                  <>
                    <Button size="sm" fullWidth onPress={savePhoto} isDisabled={uploadingPhoto}>
                      {uploadingPhoto ? <Loader2 className="size-4" /> : <Upload className="size-4" />}
                      {uploadingPhoto ? t("profile.uploadingPhoto") : t("profile.savePhoto")}
                    </Button>
                    <Button size="sm" variant="ghost" fullWidth onPress={() => { setPhotoFile(null); setPreviewUrl(null); }}>
                      {t("common:cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" fullWidth onPress={() => fileRef.current?.click()}>
                      <Camera className="size-4" /> {t("profile.changePhoto")}
                    </Button>
                    {profile?.avatarUrl && (
                      <Button size="sm" variant="danger-soft" fullWidth onPress={deletePhoto} isDisabled={removingPhoto}>
                        {removingPhoto ? <Loader2 className="size-4" /> : <Trash2 className="size-4" />}
                        {t("profile.removePhoto")}
                      </Button>
                    )}
                  </>
                )}
                <p className="text-xs text-muted-foreground">{t("profile.photoFormat")}</p>
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold leading-tight text-foreground">{profile?.name}</p>
                <p className="text-sm text-muted-foreground">{profile?.jobTitle || t("profile.noJobTitle")}</p>
                <p className="text-xs text-muted-foreground"><bdi dir="ltr">{profile?.email}</bdi></p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 border-t border-border pt-4 text-start">
                <Metadata label={t("profile.memberSince")} value={formatDateInTimezone(profile?.createdAt, timezone, false)} dir="ltr" />
                <Metadata label={t("profile.lastLogin")} value={formatDateInTimezone(profile?.lastLoginAt, timezone)} dir="ltr" />
                <Metadata label={t("profile.username")} value={profile?.username ?? "—"} mono />
                <Metadata label={t("profile.timezone")} value={timezone} />
              </div>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base"><Shield className="size-4 text-muted-foreground" />{t("profile.organisationAccess")}</Card.Title>
              <Card.Description>{t("profile.organisationAccessDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-3">
              <Metadata label={t("profile.systemRole")} value={profile?.roleLabel ?? "—"} />
              <Metadata label={t("profile.accessScope")} value={accessDetails} />
              <Metadata label={t("profile.accountStatus")} value={t(`profile.status.${profile?.status ?? "inactive"}`)} />
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("profile.emailVerification")}</p>
                <Chip size="sm" variant="soft" color={profile?.emailVerified ? "success" : "default"} className="mt-1">
                  {profile?.emailVerified ? t("profile.verified") : t("profile.notVerified")}
                </Chip>
              </div>
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">{t("profile.assignmentAdminNotice")}</p>
            </Card.Content>
          </Card>
        </aside>

        <main className="space-y-4 lg:col-span-2">
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base"><User className="size-4 text-muted-foreground" />{t("profile.personalInfo")}</Card.Title>
              <Card.Description>{t("profile.personalInfoDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              <form className="space-y-4" noValidate onSubmit={savePersonal}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField id="profile-name" value={name} onChange={setName} isRequired isInvalid={!name.trim()} maxLength={150} fullWidth>
                    <Label>{t("profile.fullNameLabel")}</Label>
                    <Input />
                  </TextField>
                  <TextField id="profile-job" value={jobTitle} onChange={setJobTitle} maxLength={120} fullWidth>
                    <Label>{t("profile.jobTitle")}</Label>
                    <Input placeholder={t("profile.jobTitlePlaceholder")} />
                  </TextField>
                </div>
                <TextField id="profile-phone" type="tel" value={phone} onChange={setPhone} fullWidth>
                  <Label>{t("profile.phoneLabel")}</Label>
                  <Input dir="ltr" placeholder={t("profile.phonePlaceholder")} />
                </TextField>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" isDisabled={!personalDirty || savingPersonal || !name.trim()}>
                    {savingPersonal ? <Loader2 className="size-4" /> : <Save className="size-4" />}
                    {savingPersonal ? t("profile.saving") : t("profile.saveChanges")}
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base"><Settings className="size-4 text-muted-foreground" />{t("profile.accountSettings")}</Card.Title>
              <Card.Description>{t("profile.accountSettingsDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t("profile.interfaceLanguage")}
                  value={language}
                  onChange={(value) => setLanguage(value === "ar" ? "ar" : "en")}
                  options={[{ value: "en", label: t("common:english") }, { value: "ar", label: t("common:arabic") }]}
                  className="w-full"
                  triggerClassName="w-full"
                />
                <SelectField
                  label={t("profile.timezone")}
                  value={timezone}
                  onChange={setTimezone}
                  options={TIMEZONES.map((value) => ({ value, label: t(`profile.timezones.${value.replace("/", "_")}`) }))}
                  className="w-full"
                  triggerClassName="w-full"
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onPress={saveSettings} isDisabled={!settingsDirty || savingSettings}>
                  {savingSettings ? <Loader2 className="size-4" /> : <Save className="size-4" />}
                  {savingSettings ? t("profile.saving") : t("profile.saveSettings")}
                </Button>
              </div>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base"><Bell className="size-4 text-muted-foreground" />{t("profile.notifPreferences")}</Card.Title>
              <Card.Description>{t("profile.notifPreferencesDesc")}</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("profile.notifPreferencesHint")}</p>
              {/* Navigation, so a real link — drawn with HeroUI's button classes. */}
              <Link href="/notification-preferences" className="button button--outline button--sm inline-flex w-fit">
                <Bell className="size-4" />{t("profile.manageNotifPreferences")}
              </Link>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base"><Shield className="size-4 text-muted-foreground" />{t("profile.changePassword")}</Card.Title>
              <Card.Description>{t("profile.changePasswordDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              <form className="space-y-4" noValidate onSubmit={submitPassword}>
                <PasswordField id="profile-current-password" label={t("profile.currentPassword")} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
                <PasswordField id="profile-new-password" label={t("profile.newPassword")} value={newPassword} onChange={setNewPassword} autoComplete="new-password">
                  {newPassword && <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1" aria-live="polite">
                    {(["length", "letter", "number"] as const).map((rule) => <p key={rule} className={`flex items-center gap-1 text-xs ${passwordPolicy[rule] ? "text-success" : "text-muted-foreground"}`}>
                      <CheckCircle2 className="size-3" />{t(`profile.passwordRule.${rule}`)}
                    </p>)}
                  </div>}
                </PasswordField>
                <PasswordField
                  id="profile-confirm-password"
                  label={t("profile.confirmNewPassword")}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  isInvalid={confirmPassword.length > 0 && !passwordMatches}
                  errorMessage={confirmPassword.length > 0 && !passwordMatches ? t("profile.passwordMismatch") : undefined}
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="danger" size="sm" isDisabled={changingPassword || !currentPassword || !passwordValid}>
                    {changingPassword ? <Loader2 className="size-4" /> : <Lock className="size-4" />}
                    {changingPassword ? t("profile.changingPassword") : t("profile.changePasswordBtn")}
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>
        </main>
      </div>
    </div>
  );
}

function Metadata({ label, value, mono = false, dir }: { label: string; value: string; mono?: boolean; dir?: "ltr" | "rtl" }) {
  return <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={`mt-0.5 text-sm text-foreground ${mono ? "font-mono" : ""}`}><bdi dir={dir}>{value}</bdi></p></div>;
}

function ProfileLoading() {
  return <div className="space-y-6"><Skeleton className="h-10 w-48 rounded-lg" /><div className="grid gap-6 lg:grid-cols-3"><div className="space-y-4"><Skeleton className="h-[460px] rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div><div className="space-y-4 lg:col-span-2"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div></div></div>;
}