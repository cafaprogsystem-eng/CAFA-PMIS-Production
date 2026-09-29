import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Chip, ProgressBar } from "@heroui/react";
import { Mic, Square, Play, Pause, RotateCcw, Volume2, Loader2, X } from "@/components/icons";

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
  // The recorder's onstop handler is created when recording starts; reading
  // the elapsed state there would always see 0, so the seconds live in a ref.
  const elapsedRef = useRef(0);
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
        onChange({ blob, mimeType, durationSeconds: elapsedRef.current, blobUrl });
        setState("recorded");
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      recorder.start(250);
      setState("recording");
      setElapsed(0);
      elapsedRef.current = 0;
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= MAX_RECORD_SECONDS) stopRecording();
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
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {/* Screen reader announcements for recording state transitions only.
          Elapsed time is intentionally excluded to avoid per-second speech
          interruptions during a recording that can last up to 5 minutes. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {state === "recording"
          ? t("voiceNote.announceStarted")
          : state === "recorded"
          ? t("voiceNote.announceStopped")
          : state === "requesting"
          ? t("voiceNote.requestingMic")
          : ""}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Volume2 className="size-4 text-[var(--muted)]" aria-hidden="true" />
        <span className="text-sm font-medium">{t("voiceNote.recorder")}</span>
        <span className="ms-auto text-xs text-[var(--muted)]">{t("voiceNote.maxDurationOptional")}</span>
      </div>

      {state === "idle" && (
        <div className="space-y-2">
          <div className="flex justify-center py-2">
            <Button type="button" onPress={() => { void startRecording(); }}>
              <Mic className="size-4" aria-hidden="true" /> {t("voiceNote.startRecording")}
            </Button>
          </div>
          {micDenied && (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t("voiceNote.micDeniedTitle")}</Alert.Title>
                <Alert.Description>{t("voiceNote.micDeniedDesc")}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
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
            <bdi dir="ltr" className="text-sm font-medium tabular-nums">{fmtDur(elapsed)}</bdi>
            <ProgressBar aria-label={t("voiceNote.recordingProgress")} value={(elapsed / MAX_RECORD_SECONDS) * 100} color="danger" size="sm" className="flex-1" />
            <bdi dir="ltr" className="text-xs text-[var(--muted)]">{fmtDur(MAX_RECORD_SECONDS)}</bdi>
          </div>
          <div className="flex justify-center">
            <Button type="button" variant="danger" onPress={stopRecording}>
              <Square className="size-4" aria-hidden="true" /> {t("voiceNote.stopRecording")}
            </Button>
          </div>
        </div>
      )}

      {state === "recorded" && value && (
        <div className="space-y-3">
          {value.blobUrl && <audio ref={bindAudio} src={value.blobUrl} preload="metadata" />}
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
            <Button type="button" variant="ghost" size="sm" isIconOnly onPress={togglePlay} aria-label={playing ? t("voiceNote.pause") : t("voiceNote.play")}>
              {playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />}
            </Button>
            <ProgressBar aria-label={t("voiceNote.playbackProgress")} value={pct} size="sm" className="flex-1" />
            <bdi dir="ltr" className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
              {fmtDur(playing ? currentTime : value.durationSeconds)}
            </bdi>
            <Chip size="sm" variant="soft" className="shrink-0">{t("voiceNote.recorded")}</Chip>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="tertiary" size="sm" onPress={reRecord}>
              <RotateCcw className="size-3.5" aria-hidden="true" /> {t("voiceNote.reRecord")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={discard}>
              <X className="size-3.5" aria-hidden="true" /> {t("voiceNote.discard")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
