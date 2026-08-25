import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Mic, Square, Play, Pause, Trash2, RotateCcw, Loader2, Volume2,
} from "lucide-react";
import { requestUploadUrl, useListVoiceNotes } from "@workspace/api-client-react";

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
    else { audio.play(); setPlaying(true); }
  };

  const pct = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <audio ref={audioRef} src={src} preload="metadata" />
      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={toggle} aria-label={playing ? t("voiceNotePlayback.pause") : t("voiceNotePlayback.play")}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
        {formatDuration(playing ? currentTime : duration)}
      </span>
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
  const { toast } = useToast();
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
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
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
        stream.getTracks().forEach(t => t.stop());
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
      toast({
        title: t("voiceNote.micDeniedTitle"),
        description: t("voiceNote.micDeniedDesc"),
        variant: "destructive",
      });
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

      await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": mimeType },
      });

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
      toast({ title: t("voiceNote.saved") });
    } catch {
      toast({ title: t("voiceNote.uploadFailed"), description: t("voiceNote.uploadFailedDesc"), variant: "destructive" });
      setState("recorded");
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("voiceNote.recorder")}</span>
        <span className="text-xs text-muted-foreground ms-auto">{t("voiceNote.maxDuration")}</span>
      </div>

      {state === "idle" && (
        <div className="flex justify-center py-2">
          <Button type="button" onClick={startRecording} className="gap-2">
            <Mic className="h-4 w-4" /> {t("voiceNote.startRecording")}
          </Button>
        </div>
      )}

      {state === "requesting" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("voiceNote.requestingMic")}
        </div>
      )}

      {state === "recording" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium tabular-nums">{formatDuration(elapsed)}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-destructive rounded-full transition-all"
                style={{ width: `${(elapsed / MAX_SECONDS) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{formatDuration(MAX_SECONDS)}</span>
          </div>
          <div className="flex justify-center">
            <Button type="button" variant="destructive" onClick={stopRecording} className="gap-2">
              <Square className="h-4 w-4" /> {t("voiceNote.stopRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "recorded" && blobUrl && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-background rounded border">
            <AudioPlayer src={blobUrl} duration={elapsed} />
            <Badge variant="secondary" className="text-xs shrink-0">{formatDuration(elapsed)}</Badge>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={reRecord} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> {t("voiceNote.reRecord")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>{t("cancel")}</Button>
            <Button type="button" size="sm" onClick={saveRecording} className="gap-1">
              {t("voiceNote.saveRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("uploadingFile")}
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
  const { toast } = useToast();
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(note.playbackUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
      toast({ title: t("voiceNote.couldNotLoad"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    try {
      const res = await fetch(`/api/voice-notes/${note.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      onDelete(note.id);
      toast({ title: t("voiceNote.deleted") });
    } catch {
      toast({ title: t("voiceNote.couldNotDelete"), variant: "destructive" });
    }
    setConfirming(false);
  };

  const recordedAt = new Date(note.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/30 rounded border">
      {note.availabilityStatus === "unavailable" ? (
        <span role="status" className="text-xs text-muted-foreground">File Unavailable</span>
      ) : loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : playbackUrl ? (
        <AudioPlayer src={playbackUrl} duration={note.durationSeconds} />
      ) : (
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={loadUrl} aria-label={t("voiceNotePlayback.play")}>
          <Play className="h-3.5 w-3.5" />
        </Button>
      )}

      <div className="flex flex-col min-w-0 shrink-0">
        <span className="text-xs text-muted-foreground">{recordedAt}</span>
        {note.recordedByName && (
          <span className="text-xs text-muted-foreground truncate">{note.recordedByName}</span>
        )}
      </div>

      <Badge variant="outline" className="text-xs shrink-0">{formatDuration(note.durationSeconds)}</Badge>

      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 shrink-0 ${confirming ? "text-destructive" : ""}`}
          onClick={handleDelete}
          title={confirming ? t("voiceNote.confirmDelete") : t("voiceNote.deleteNote")}
          aria-label={confirming ? t("voiceNote.confirmDelete") : t("voiceNote.deleteNote")}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
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
  const [showRecorder, setShowRecorder] = useState(false);
  const [localNotes, setLocalNotes] = useState<VoiceNote[]>([]);

  const { data: fetchedNotes, isLoading } = useListVoiceNotes({ entityType, entityId });

  // Merge server notes with any locally-added notes (avoid duplicates)
  const serverNotes: VoiceNote[] = (fetchedNotes ?? []) as VoiceNote[];
  const allNoteIds = new Set(serverNotes.map(n => n.id));
  const merged = [
    ...serverNotes,
    ...localNotes.filter(n => !allNoteIds.has(n.id)),
  ];

  const handleAdded = (note: VoiceNote) => {
    setLocalNotes(prev => [note, ...prev]);
    setShowRecorder(false);
  };

  const handleDeleted = (id: number) => {
    setLocalNotes(prev => prev.filter(n => n.id !== id));
    // Also remove from server notes via refetch — optimistic removal only for local list
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {merged.length === 0 && !showRecorder && (
        <p className="text-xs text-muted-foreground italic">{t("voiceNote.noNotes")}</p>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowRecorder(true)}
          >
            <Mic className="h-3.5 w-3.5" /> {t("voiceNote.addVoiceNote")}
          </Button>
        )
      )}
    </div>
  );
}
