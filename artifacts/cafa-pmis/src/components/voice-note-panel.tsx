import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Chip, ProgressBar, Skeleton } from "@heroui/react";
import { toast } from "sonner";
import {
  Mic, Square, Play, Pause, Trash2, RotateCcw, Loader2, Volume2,
} from "@/components/icons";
import { ConfirmModal } from "@/components/confirm-modal";
import { requestUploadUrl, useListVoiceNotes, getListVoiceNotesQueryKey } from "@workspace/api-client-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VoiceNoteEntity = "project" | "plan" | "report" | "risk" | "comment";

export interface VoiceNote {
  id: number;
  entityType: string;
  entityId: number;
  fileName: string;
  contentType: string;
  durationSeconds: number;
  recordedByName?: string | null;
  createdAt: string;
  playbackUrl?: string;
  availabilityStatus?: "available" | "unavailable";
}

interface VoiceNotePanelProps {
  entityType: VoiceNoteEntity;
  entityId: number;
  readOnly?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const MAX_SECONDS = 300; // 5 minutes

function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "audio/webm";
}

// ── Mini audio player ──────────────────────────────────────────────────────────

function AudioPlayer({ src, duration }: { src: string; duration: number }) {
  const { t } = useTranslation("common");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(Math.floor(audio.currentTime));
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { void audio.play(); setPlaying(true); }
  };

  const pct = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <audio ref={audioRef} src={src} preload="metadata" />
      <Button type="button" variant="ghost" size="sm" isIconOnly onPress={toggle} aria-label={playing ? t("voiceNotePlayback.pause") : t("voiceNotePlayback.play")}>
        {playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />}
      </Button>
      <ProgressBar aria-label={t("voiceNote.playbackProgress")} value={pct} size="sm" className="flex-1" />
      <bdi dir="ltr" className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
        {formatDuration(playing ? currentTime : duration)}
      </bdi>
    </div>
  );
}

// ── Recorder ──────────────────────────────────────────────────────────────────

interface RecorderProps {
  entityType: VoiceNoteEntity;
  entityId: number;
  onSaved: (note: VoiceNote) => void;
  onCancel: () => void;
}

function Recorder({ entityType, entityId, onSaved, onCancel }: RecorderProps) {
  const { t } = useTranslation("common");
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "recorded" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("audio/webm");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobEvent["data"][]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(tr => tr.stop());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const startRecording = async () => {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const mime = getSupportedMimeType();
      setMimeType(mime);
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: mime });
        setBlob(recorded);
        setBlobUrl(URL.createObjectURL(recorded));
        stream.getTracks().forEach(tr => tr.stop());
        setState("recorded");
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.start(500); // collect every 500ms
      setState("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          if (prev + 1 >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setState("idle");
      toast.error(t("voiceNote.micDeniedTitle"), { description: t("voiceNote.micDeniedDesc") });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const reRecord = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setElapsed(0);
    setState("idle");
  };

  const saveRecording = async () => {
    if (!blob) return;
    setState("uploading");
    try {
      const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
      const fileName = `voice-note-${entityType}-${entityId}-${Date.now()}.${ext}`;

      const { uploadURL, objectPath } = await requestUploadUrl({
        name: fileName,
        size: blob.size,
        contentType: mimeType,
      });

      // A failed upload must not be registered as a playable note.
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": mimeType },
      });
      if (!put.ok) throw new Error("upload failed");

      const res = await fetch("/api/voice-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          fileName,
          objectPath,
          contentType: mimeType,
          durationSeconds: elapsed,
        }),
      });

      if (!res.ok) throw new Error("Failed to save voice note");
      const saved: VoiceNote = await res.json();
      onSaved(saved);
      toast.success(t("voiceNote.saved"));
    } catch {
      toast.error(t("voiceNote.uploadFailed"), { description: t("voiceNote.uploadFailedDesc") });
      setState("recorded");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Volume2 className="size-4 text-[var(--muted)]" aria-hidden="true" />
        <span className="text-sm font-medium">{t("voiceNote.recorder")}</span>
        <span className="ms-auto text-xs text-[var(--muted)]">{t("voiceNote.maxDuration")}</span>
      </div>

      {state === "idle" && (
        <div className="flex justify-center py-2">
          <Button type="button" onPress={() => { void startRecording(); }}>
            <Mic className="size-4" aria-hidden="true" /> {t("voiceNote.startRecording")}
          </Button>
        </div>
      )}

      {state === "requesting" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-[var(--muted)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("voiceNote.requestingMic")}
        </div>
      )}

      {state === "recording" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--danger)]" aria-hidden="true" />
            <bdi dir="ltr" className="text-sm font-medium tabular-nums">{formatDuration(elapsed)}</bdi>
            <ProgressBar aria-label={t("voiceNote.recordingProgress")} value={(elapsed / MAX_SECONDS) * 100} color="danger" size="sm" className="flex-1" />
            <bdi dir="ltr" className="text-xs text-[var(--muted)]">{formatDuration(MAX_SECONDS)}</bdi>
          </div>
          <div className="flex justify-center">
            <Button type="button" variant="danger" onPress={stopRecording}>
              <Square className="size-4" aria-hidden="true" /> {t("voiceNote.stopRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "recorded" && blobUrl && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
            <AudioPlayer src={blobUrl} duration={elapsed} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="tertiary" size="sm" onPress={reRecord}>
              <RotateCcw className="size-3.5" aria-hidden="true" /> {t("voiceNote.reRecord")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={onCancel}>{t("cancel")}</Button>
            <Button type="button" size="sm" onPress={() => { void saveRecording(); }}>
              {t("voiceNote.saveRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-[var(--muted)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("uploadingFile")}
        </div>
      )}
    </div>
  );
}

// ── Voice Note Item ────────────────────────────────────────────────────────────

interface VoiceNoteItemProps {
  note: VoiceNote;
  onDelete: (id: number) => void;
  readOnly?: boolean;
}

function VoiceNoteItem({ note, onDelete, readOnly = false }: VoiceNoteItemProps) {
  const { t } = useTranslation("common");
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(note.playbackUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadUrl = async () => {
    if (note.availabilityStatus === "unavailable") return;
    if (playbackUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/voice-notes/${note.id}/url`);
      if (!res.ok) throw new Error("Failed");
      const { url } = await res.json();
      setPlaybackUrl(url);
    } catch {
      toast.error(t("voiceNote.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/voice-notes/${note.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      onDelete(note.id);
      toast.success(t("voiceNote.deleted"));
      setConfirming(false);
    } catch {
      toast.error(t("voiceNote.couldNotDelete"));
    } finally {
      setDeleting(false);
    }
  };

  const recordedAt = new Date(note.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      {note.availabilityStatus === "unavailable" ? (
        <span role="status" className="text-xs text-[var(--muted)]">{t("voiceNote.fileUnavailable")}</span>
      ) : loading ? (
        <Loader2 className="size-3.5 animate-spin text-[var(--muted)]" aria-hidden="true" />
      ) : playbackUrl ? (
        <AudioPlayer src={playbackUrl} duration={note.durationSeconds} />
      ) : (
        <Button type="button" variant="ghost" size="sm" isIconOnly onPress={() => { void loadUrl(); }} aria-label={t("voiceNotePlayback.play")}>
          <Play className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </Button>
      )}

      <div className="flex min-w-0 shrink-0 flex-col">
        <bdi dir="ltr" className="text-xs text-[var(--muted)]">{recordedAt}</bdi>
        {note.recordedByName && (
          <span className="truncate text-xs text-[var(--muted)]">{note.recordedByName}</span>
        )}
      </div>

      <Chip size="sm" variant="tertiary" className="shrink-0"><bdi dir="ltr">{formatDuration(note.durationSeconds)}</bdi></Chip>

      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          isIconOnly
          className="shrink-0 text-[var(--danger)]"
          onPress={() => setConfirming(true)}
          aria-label={t("voiceNote.deleteNote")}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      <ConfirmModal
        isOpen={confirming}
        title={t("voiceNote.deleteConfirmTitle")}
        message={t("voiceNote.deleteConfirmMessage")}
        confirmLabel={t("voiceNote.deleteNote")}
        cancelLabel={t("cancel")}
        isPending={deleting}
        onConfirm={() => { void handleDelete(); }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export function VoiceNotePanel({
  entityType,
  entityId,
  readOnly = false,
}: VoiceNotePanelProps) {
  const { t } = useTranslation("common");
  const qc = useQueryClient();
  const [showRecorder, setShowRecorder] = useState(false);
  const [localNotes, setLocalNotes] = useState<VoiceNote[]>([]);
  // Notes deleted in this session disappear at once, before the refetch lands.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  const params = { entityType, entityId };
  const { data: fetchedNotes, isLoading } = useListVoiceNotes(params);

  // Merge server notes with any locally-added notes (avoid duplicates)
  const serverNotes: VoiceNote[] = (fetchedNotes ?? []) as VoiceNote[];
  const allNoteIds = new Set(serverNotes.map(n => n.id));
  const merged = [
    ...serverNotes,
    ...localNotes.filter(n => !allNoteIds.has(n.id)),
  ].filter((n) => !deletedIds.has(n.id));

  const handleAdded = (note: VoiceNote) => {
    setLocalNotes(prev => [note, ...prev]);
    setShowRecorder(false);
  };

  const handleDeleted = (id: number) => {
    setLocalNotes(prev => prev.filter(n => n.id !== id));
    setDeletedIds(prev => new Set(prev).add(id));
    void qc.invalidateQueries({ queryKey: getListVoiceNotesQueryKey(params) });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {merged.length === 0 && !showRecorder && (
        <p className="text-xs italic text-[var(--muted)]">{t("voiceNote.noNotes")}</p>
      )}
      {merged.map(note => (
        <VoiceNoteItem key={note.id} note={note} onDelete={handleDeleted} readOnly={readOnly} />
      ))}
      {!readOnly && (
        showRecorder ? (
          <Recorder
            entityType={entityType}
            entityId={entityId}
            onSaved={handleAdded}
            onCancel={() => setShowRecorder(false)}
          />
        ) : (
          <Button type="button" variant="tertiary" size="sm" onPress={() => setShowRecorder(true)}>
            <Mic className="size-3.5" aria-hidden="true" /> {t("voiceNote.addVoiceNote")}
          </Button>
        )
      )}
    </div>
  );
}
