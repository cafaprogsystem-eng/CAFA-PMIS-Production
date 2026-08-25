import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, Square, Play, Pause, RotateCcw, Volume2, Loader2, X } from "lucide-react";

const MAX_RECORD_SECONDS = 300;

function fmtDur(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function getSupportedMime() {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

export interface PendingNote {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  blobUrl: string;
}

export interface FormVoiceRecorderProps {
  value: PendingNote | null;
  onChange: (v: PendingNote | null) => void;
}

export function FormVoiceRecorder({ value, onChange }: FormVoiceRecorderProps) {
  const { t } = useTranslation("common");
  type RecState = "idle" | "requesting" | "recording" | "recorded";
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [micDenied, setMicDenied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    timerRef.current && clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    value?.blobUrl && URL.revokeObjectURL(value.blobUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = getSupportedMime();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        onChange({ blob, mimeType, durationSeconds: elapsed, blobUrl });
        setState("recorded");
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      recorder.start(250);
      setState("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          if (prev + 1 >= MAX_RECORD_SECONDS) { stopRecording(); return prev + 1; }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setState("idle");
      setMicDenied(true);
    }
  };

  const stopRecording = () => {
    timerRef.current && clearInterval(timerRef.current);
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
  };

  const reRecord = () => {
    if (value?.blobUrl) URL.revokeObjectURL(value.blobUrl);
    onChange(null);
    setElapsed(0);
    setPlaying(false);
    setCurrentTime(0);
    setState("idle");
  };

  const discard = () => {
    if (value?.blobUrl) URL.revokeObjectURL(value.blobUrl);
    onChange(null);
    setElapsed(0);
    setPlaying(false);
    setCurrentTime(0);
    setState("idle");
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  const bindAudio = (el: HTMLAudioElement | null) => {
    if (!el) return;
    audioRef.current = el;
    el.onended = () => { setPlaying(false); setCurrentTime(0); };
    el.ontimeupdate = () => setCurrentTime(Math.floor(el.currentTime));
  };

  const dur = value?.durationSeconds ?? elapsed;
  const pct = dur > 0 ? Math.min((currentTime / dur) * 100, 100) : 0;

  return (
    <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
      {/* Screen reader announcements for recording state transitions only.
          Elapsed time is intentionally excluded to avoid per-second speech
          interruptions during a recording that can last up to 5 minutes. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {state === "recording"
          ? "Recording started."
          : state === "recorded"
          ? "Recording stopped."
          : state === "requesting"
          ? "Requesting microphone access."
          : ""}
      </span>
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium">{t("voiceNote.recorder")}</span>
        <span className="text-xs text-muted-foreground ms-auto">{t("voiceNote.maxDurationOptional")}</span>
      </div>

      {state === "idle" && (
        <div className="space-y-2">
          <div className="flex justify-center py-2">
            <Button type="button" onClick={startRecording} className="gap-2">
              <Mic className="h-4 w-4" /> {t("voiceNote.startRecording")}
            </Button>
          </div>
          {micDenied && (
            <p className="text-xs text-muted-foreground text-center">
              Microphone access is required to record a voice note.
            </p>
          )}
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
            <span className="text-sm font-medium tabular-nums">{fmtDur(elapsed)}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-destructive rounded-full transition-all" style={{ width: `${(elapsed / MAX_RECORD_SECONDS) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{fmtDur(MAX_RECORD_SECONDS)}</span>
          </div>
          <div className="flex justify-center">
            <Button type="button" variant="destructive" onClick={stopRecording} className="gap-2">
              <Square className="h-4 w-4" /> {t("voiceNote.stopRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "recorded" && value && (
        <div className="space-y-3">
          {value.blobUrl && <audio ref={bindAudio} src={value.blobUrl} preload="metadata" />}
          <div className="flex items-center gap-2 p-2 bg-background rounded border">
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={togglePlay} aria-label={playing ? "Pause voice note" : "Play voice note"}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
              {fmtDur(playing ? currentTime : value.durationSeconds)}
            </span>
            <Badge variant="secondary" className="text-xs shrink-0">{t("voiceNote.recorded")}</Badge>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={reRecord} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> {t("voiceNote.reRecord")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={discard} className="gap-1 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> {t("voiceNote.discard")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
