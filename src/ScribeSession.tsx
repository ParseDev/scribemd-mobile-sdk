import type { EventSubscription } from 'expo-modules-core';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  createEncounter,
  finalizeEncounter,
  getEncounter,
  updateNotes,
  type EncounterMode,
  type GeneratedNote,
} from './api/encounters';
import { syncEncounter } from './api/sync';
import { useScribeMDAuth } from './auth/ScribeMDProvider';
import { NoteGenerationError, useNoteGeneration } from './hooks/useNoteGeneration';
import { useSegmentRecording } from './hooks/useSegmentRecording';
import {
  useWebSocketTranscription,
  type TranscriptSegment,
} from './hooks/useWebSocketTranscription';
import {
  addAudioDataListener,
  addAudioLevelListener,
  addErrorListener,
  pauseStreaming,
  resumeStreaming,
  startStreaming,
  stopStreaming,
} from './microphone';
import {
  isLocalEncounterId,
  markFinalized,
  purgeSession,
  rekeySession,
  saveSession,
  updateSession,
} from './storage/sessionStore';
import { applyLanguage, strings } from './strings';
import { ContextInput } from './ui/ContextInput';
import { Controls, type FinishControlConfig } from './ui/Controls';
import { ErrorBanner } from './ui/ErrorBanner';
import { GenerationProgress } from './ui/GenerationProgress';
import { TablerIcon } from './ui/icons';
import { IdleSkeleton } from './ui/IdleSkeleton';
import { NoteReview } from './ui/NoteReview';
import { ModeToggle } from './ui/ModeToggle';
import { RecordButton } from './ui/RecordButton';
import { StatusPill, type SessionStatus } from './ui/StatusPill';
import { TemplatePicker } from './ui/TemplatePicker';
import { Timer } from './ui/Timer';
import { TranscriptView } from './ui/TranscriptView';
import { Waveform } from './ui/Waveform';
import {
  ThemeContext,
  palette,
  radii,
  resolvePalette,
  spacing,
  withAlpha,
  type ScribeSessionTheme,
} from './ui/theme';
import { useSafeInsets } from './ui/useSafeInsets';

export interface PatientContext {
  patientId?: string;
  medicalRecord?: string;
  timestamp?: string;
}

export interface ScribeSessionResult {
  /** Raw transcript — always present (backward compatible). */
  transcript: string;
  /** ScribeMD encounter id, when an encounter was created for the session. */
  encounterId?: string;
  /** Generated clinical note. Absent when generation failed or timed out. */
  note?: GeneratedNote;
}

/**
 * Thrown to `onError` when note generation fails after a successful
 * recording. Carries the transcript so the host never loses data.
 */
export class NoteGenerationFailedError extends Error {
  readonly transcript: string;
  readonly encounterId?: string;
  /** True when generation exceeded the 3 minute budget. */
  readonly timedOut: boolean;

  constructor(message: string, transcript: string, encounterId?: string, timedOut = false) {
    super(message);
    this.name = 'NoteGenerationFailedError';
    this.transcript = transcript;
    this.encounterId = encounterId;
    this.timedOut = timedOut;
  }
}

export interface ScribeSessionProps {
  /** Read-only patient details shown in the session header. */
  patientContext?: PatientContext;
  /**
   * Note template preselected for the session (e.g. passed by the host
   * app). Wins over the user's server-side default; the doctor can still
   * change it in the picker. Falls back to user -> organization default.
   */
  noteTemplateId?: string;
  /**
   * Initial recording mode. Defaults to the user's server-side preference
   * (active_encounter_mode), falling back to dictation.
   */
  initialMode?: EncounterMode;
  /**
   * Hide the template picker so the session is locked to `noteTemplateId`
   * (web-widget parity: "restrict to note template").
   */
  noteTemplateLocked?: boolean;
  /**
   * Pre-fills the "Add context" field (web-widget parity: consultation
   * context). The clinician can still edit it before recording.
   */
  initialContext?: string;
  /**
   * Start recording immediately once auth (and user config) are ready —
   * no idle screen (web-widget parity: auto init). The mic permission
   * prompt still applies.
   */
  autoStart?: boolean;
  onComplete: (result: ScribeSessionResult) => void;
  /**
   * Session/generation failures. Note generation failures are reported as
   * NoteGenerationFailedError (with `.transcript` attached), followed by an
   * onComplete carrying the transcript, so hosts never lose data.
   */
  onError?: (error: Error) => void;
  /** When provided, a Cancel action is shown in the header. */
  onCancel?: () => void;
  /**
   * Called when the doctor taps "Open settings" on the setup-required
   * screen (shown when the SDK can't start — e.g. no/invalid token). Wire
   * it to your own settings/config screen. Without it the button is hidden.
   */
  onConfigure?: () => void;
  /** Optional accent/background override. See ScribeSessionTheme. */
  theme?: ScribeSessionTheme;
  /**
   * Finish-control customization: slide-to-finish (default) or a plain
   * button, with optional label/color overrides.
   */
  finishControl?: FinishControlConfig;
  /**
   * In-SDK note review (default true): after generation the doctor sees the
   * note as editable sections, can correct it, and onComplete fires only on
   * approve — with the edited note, also saved back to ScribeMD. Set false
   * to receive the note immediately and review it in the host app instead.
   */
  noteReview?: boolean;
  /**
   * Hide the SDK's own header chrome (title, patient chips, close button)
   * so the host renders its own — pair with a ref and `requestClose()` so
   * the host's close control still runs the SDK's confirmation/discard
   * logic. The recording timer stays (it is state, not chrome).
   */
  hideHeader?: boolean;
}

/** Imperative surface for hosts that own the surrounding chrome. */
export interface ScribeSessionHandle {
  /**
   * Close the session THROUGH the SDK's logic: discard confirmation while
   * recording, light close confirmation otherwise; `onCancel` fires after
   * the user confirms. Wire the host's own close button to this.
   */
  requestClose: () => void;
}

type SessionPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'generating'
  | 'review'
  | 'complete'
  | 'error';

const WAVEFORM_BAR_COUNT = 28;
/** How long we keep the socket open after Stop to flush remaining finals. */
const FINALIZE_FLUSH_MS = 1500;
const AUDIO_SAMPLE_RATE = 16_000;
/** App parity: live dictation state syncs to the server every 5s. */
const DICTATION_SYNC_INTERVAL_MS = 5_000;
/** Note budget. Visit is larger: batch transcription runs first server-side. */
const DICTATION_GENERATION_TIMEOUT_MS = 180_000;
const VISIT_GENERATION_TIMEOUT_MS = 360_000;

/** App-parity transcription_data payload: {id: {text, speaker, start_time}}. */
function buildTranscriptionData(segments: TranscriptSegment[]): string {
  const map: { [id: string]: { text: string; speaker?: string; start_time: number } } = {};
  const firstAt = segments[0]?.receivedAt ?? 0;
  for (const segment of segments) {
    map[segment.id] = {
      text: segment.text,
      speaker: segment.speaker,
      start_time: Math.max(0, (segment.receivedAt - firstAt) / 1000),
    };
  }
  return JSON.stringify(map);
}

// --- base64 -> ArrayBuffer (PCM16 frames from the native module) -----------

const B64_LOOKUP = (() => {
  const lookup = new Uint8Array(128);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  return lookup;
})();

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  let end = base64.length;
  while (end > 0 && base64.charCodeAt(end - 1) === 61 /* '=' */) {
    end--;
  }
  const byteLength = Math.floor((end * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  for (let i = 0; i < end; i += 4) {
    const a = B64_LOOKUP[base64.charCodeAt(i)];
    const b = B64_LOOKUP[base64.charCodeAt(i + 1)];
    const c = i + 2 < end ? B64_LOOKUP[base64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < end ? B64_LOOKUP[base64.charCodeAt(i + 3)] : 0;
    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------

/**
 * Self-contained recording session card. Mount it full-screen or in a sheet:
 *
 *   <ScribeMDProvider sessionToken={token}>
 *     <ScribeSession onComplete={({ transcript }) => ...} />
 *   </ScribeMDProvider>
 */
export const ScribeSession = forwardRef<ScribeSessionHandle, ScribeSessionProps>(
  function ScribeSession(
    {
      patientContext,
      noteTemplateId,
      initialMode,
      noteTemplateLocked = false,
      initialContext,
      autoStart = false,
      onComplete,
      onError,
      onCancel,
      onConfigure,
      theme,
      finishControl,
      noteReview = true,
      hideHeader = false,
    }: ScribeSessionProps,
    ref: React.ForwardedRef<ScribeSessionHandle>
  ): React.ReactElement {
  const auth = useScribeMDAuth();
  const userConfig = auth.userConfig;

  // Built-in locale (en/he) for the provider language. Idempotent, and host
  // `setStrings` overrides are always re-applied on top.
  applyLanguage(auth.language);

  const insets = useSafeInsets();
  const themePalette = useMemo(
    () => resolvePalette(theme),
    [
      theme?.accentColor,
      theme?.backgroundColor,
      theme?.surfaceColor,
      theme?.stopColor,
      theme?.textColor,
      theme?.secondaryTextColor,
    ]
  );
  const themedText = useMemo(
    () => ({
      title: { color: themePalette.textPrimary },
      secondary: { color: themePalette.textSecondary },
      muted: { color: themePalette.textMuted },
    }),
    [themePalette]
  );

  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(WAVEFORM_BAR_COUNT).fill(0));

  // Session settings (pre-recording): mode / template / context. Explicit
  // props and user edits win over the async-loaded server defaults.
  const [mode, setMode] = useState<EncounterMode>(initialMode ?? 'dictation');
  const [selectedTemplateId, setSelectedTemplateId] = useState(noteTemplateId ?? '');
  const [contextNotes, setContextNotes] = useState(initialContext ?? '');
  // In-SDK review: the generated note awaiting doctor approval.
  const [reviewData, setReviewData] = useState<{
    note: GeneratedNote;
    transcript: string;
    encounterId: string;
  } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const modeTouchedRef = useRef(initialMode != null);
  const templateTouchedRef = useRef(noteTemplateId != null);

  const phaseRef = useRef<SessionPhase>('idle');
  phaseRef.current = phase;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedTemplateIdRef = useRef(selectedTemplateId);
  selectedTemplateIdRef.current = selectedTemplateId;
  const contextNotesRef = useRef(contextNotes);
  contextNotesRef.current = contextNotes;

  // Apply server defaults once user_data lands, unless the host/user chose.
  useEffect(() => {
    if (!userConfig || phaseRef.current !== 'idle') return;
    if (!modeTouchedRef.current) setMode(userConfig.activeEncounterMode);
    if (!templateTouchedRef.current && userConfig.defaultNoteTemplateId) {
      setSelectedTemplateId(userConfig.defaultNoteTemplateId);
    }
  }, [userConfig]);

  // Boot gate: hold a skeleton until auth AND user config are ready so the
  // idle screen appears fully formed in one paint (no controls popping in).
  // A timeout reveals the degraded UI if the config fetch never lands.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBootTimedOut(true), 5_000);
    return () => clearTimeout(timer);
  }, []);
  const booting =
    (phase === 'idle' || phase === 'starting') &&
    auth.status !== 'error' &&
    (auth.status === 'initializing' ||
      (auth.status === 'ready' && userConfig == null && !bootTimedOut));

  // Preflight gate: the SDK can't start without valid credentials (no token
  // provided, or the token exchange failed). Show a clear setup-required
  // screen instead of a disabled recording UI, before we've ever recorded.
  const needsSetup =
    auth.status === 'error' && (phase === 'idle' || phase === 'starting');

  const transcription = useWebSocketTranscription({
    onError: (error) => {
      // Mid-recording transport failures surface as a dismissable banner —
      // the session (and its transcript) stays alive so the user can Stop
      // and keep everything captured so far.
      if (phaseRef.current === 'recording' || phaseRef.current === 'paused') {
        setBannerMessage(strings.errorConnectionLost);
        onErrorRef.current?.(error);
        return;
      }
      failSessionRef.current(error, strings.errorConnectionLost);
    },
  });
  const noteGeneration = useNoteGeneration();
  const segmentRecording = useSegmentRecording({
    authorizedFetch: auth.authorizedFetch,
    onUploadError: () => setBannerMessage(strings.errorSegmentUpload),
    onSegmentLimit: () => setBannerMessage(strings.errorSegmentLimit),
  });

  // Latest callbacks without re-subscribing effects.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const audioSubRef = useRef<EventSubscription | null>(null);
  const levelSubRef = useRef<EventSubscription | null>(null);
  const errorSubRef = useRef<EventSubscription | null>(null);
  const streamingRef = useRef(false);
  const stoppingRef = useRef(false);
  const encounterIdRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsedSeconds;
  const patientContextRef = useRef(patientContext);
  patientContextRef.current = patientContext;
  const transcriptSegmentsRef = useRef(transcription.segments);
  transcriptSegmentsRef.current = transcription.segments;
  const lastSyncedTranscriptRef = useRef('');
  // Bumped by cancel/fail/unmount so an in-flight handleStart notices the
  // session it was starting is gone and unwinds instead of resurrecting it.
  const sessionGenRef = useRef(0);

  const removeSubscriptions = useCallback(() => {
    audioSubRef.current?.remove();
    audioSubRef.current = null;
    levelSubRef.current?.remove();
    levelSubRef.current = null;
    errorSubRef.current?.remove();
    errorSubRef.current = null;
  }, []);

  const stopAudioPipeline = useCallback(() => {
    removeSubscriptions();
    if (streamingRef.current) {
      stopStreaming();
      streamingRef.current = false;
    }
  }, [removeSubscriptions]);

  const failSessionRef = useRef<(error: Error, friendlyMessage?: string) => void>(() => {});
  failSessionRef.current = (error: Error, friendlyMessage?: string) => {
    if (
      phaseRef.current === 'finalizing' ||
      phaseRef.current === 'generating' ||
      phaseRef.current === 'complete'
    ) {
      // The recording already ended; don't clobber a completed session.
      return;
    }
    sessionGenRef.current++;
    stopAudioPipeline();
    if (modeRef.current === 'visit') {
      // Stop the 20s rotation too — without this the error phase keeps
      // producing and uploading silent segments forever. The journal is
      // kept so the audio captured so far stays recoverable.
      void segmentRecording.finishCapture().catch(() => {});
    }
    transcription.setFinishing(true);
    transcription.disconnect();
    setErrorMessage(friendlyMessage ?? error.message);
    setPhase('error');
    onErrorRef.current?.(error);
  };

  // Session timer: counts while actively recording, holds while paused.
  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // Dictation live sync (app parity): push transcript state to the server
  // every 5s while recording so the draft is recoverable server-side, and
  // journal it locally for crash recovery.
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    if (phase !== 'recording' || modeRef.current !== 'dictation') return;
    const interval = setInterval(() => {
      const encounterId = encounterIdRef.current;
      if (!encounterId) return;
      const segments = transcriptSegmentsRef.current;
      const transcript = segments.map((segment) => segment.text.trim()).join(' ').trim();
      // Compare content, not length: STT finals routinely REPLACE the last
      // segment with a same-length correction.
      if (transcript === lastSyncedTranscriptRef.current) return;
      lastSyncedTranscriptRef.current = transcript;
      const transcriptionData = buildTranscriptionData(segments);
      // The local journal is written even for offline (local-...) sessions —
      // it is what crash recovery finalizes from.
      void updateSession(encounterId, {
        transcript,
        transcriptionData,
        durationSeconds: elapsedRef.current,
      });
      if (isLocalEncounterId(encounterId)) return;
      syncEncounter(authRef.current.authorizedFetch, encounterId, {
        duration: elapsedRef.current,
        transcription_data: transcriptionData,
        custom_conversation: transcript,
      }).catch(() => {
        // Transient sync failure: the next tick retries with fresh data.
        lastSyncedTranscriptRef.current = '';
      });
    }, DICTATION_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase]);

  // Cleanup if the host unmounts mid-session. The visit journal is kept:
  // an unmounted-mid-recording session is finalized by crash recovery.
  useEffect(() => {
    return () => {
      sessionGenRef.current++;
      stopAudioPipeline();
      void segmentRecording.finishCapture().catch(() => {});
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return;
    if (auth.status === 'error') {
      failSessionRef.current(
        new Error(auth.error ?? 'Authentication failed'),
        strings.errorAuthFailed
      );
      return;
    }

    setErrorMessage(null);
    setBannerMessage(null);
    setElapsedSeconds(0);
    setLevels(Array(WAVEFORM_BAR_COUNT).fill(0));
    transcription.reset();
    encounterIdRef.current = null;
    lastSyncedTranscriptRef.current = '';
    setReviewData(null);
    setPhase('starting');
    const sessionMode = modeRef.current;
    const generation = ++sessionGenRef.current;
    // Cancel/fail/unmount during this async flow bumps the generation; the
    // continuation must then unwind (mic off) instead of resurrecting a
    // session the user already left.
    const isStale = () => sessionGenRef.current !== generation;

    try {
      // 1. Microphone permission + capture (permission prompt is native).
      //    Streaming runs in BOTH modes: it powers the waveform and the
      //    Android foreground service; only dictation forwards the PCM.
      await startStreaming({ sampleRate: AUDIO_SAMPLE_RATE, channels: 1 });
      streamingRef.current = true;
      if (isStale()) {
        stopAudioPipeline();
        return;
      }

      errorSubRef.current = addErrorListener((event) => {
        failSessionRef.current(new Error(event.error), strings.errorMicrophone);
      });
      levelSubRef.current = addAudioLevelListener((event) => {
        // Freeze the waveform while paused (native may still emit levels).
        if (phaseRef.current === 'paused') return;
        setLevels((previous) => [...previous.slice(1), event.level]);
      });
      if (sessionMode === 'dictation') {
        // Chunks emitted before the socket opens are buffered by the hook
        // and drained on connect, so no audio is lost while connecting.
        audioSubRef.current = addAudioDataListener((event) => {
          try {
            transcription.sendAudioChunk(base64ToArrayBuffer(event.data));
          } catch {
            // Skip malformed frames rather than killing the session.
          }
        });
      }

      // 2. Draft encounter, created before capture is attributed so the STT
      //    stream / audio segments belong to it. Creation failure is non-
      //    fatal: the session records against a local placeholder id that
      //    Stop (or crash recovery) resolves into a real encounter later.
      try {
        encounterIdRef.current = await createEncounter(auth.authorizedFetch, {
          encounterMode: sessionMode,
          language: auth.language,
          patientContext: patientContextRef.current,
          noteTemplateId: selectedTemplateIdRef.current || undefined,
          contextNotes: contextNotesRef.current,
        });
      } catch {
        encounterIdRef.current = `local-${Date.now()}`;
      }
      if (isStale()) {
        stopAudioPipeline();
        encounterIdRef.current = null;
        return;
      }

      // 3. Journal the session for crash recovery (best-effort).
      void saveSession({
        encounterId: encounterIdRef.current,
        mode: sessionMode,
        createdAt: new Date().toISOString(),
        language: auth.language,
        noteTemplateId: selectedTemplateIdRef.current || undefined,
        contextNotes: contextNotesRef.current || undefined,
        segments: [],
        finalized: false,
      });

      // 4. Mode pipeline: rolling segment files (visit) or live STT socket.
      if (sessionMode === 'visit') {
        await segmentRecording.start(encounterIdRef.current!);
      } else {
        // Local placeholder ids are never sent to the STT gateway.
        const streamEncounterId = encounterIdRef.current;
        await transcription.connect({
          encounterId:
            streamEncounterId && !isLocalEncounterId(streamEncounterId)
              ? streamEncounterId
              : undefined,
        });
      }

      // 5. Live — unless the user cancelled while the pipeline was starting.
      if (isStale()) {
        stopAudioPipeline();
        if (sessionMode === 'visit') {
          void segmentRecording.abort().catch(() => {});
        } else {
          transcription.setFinishing(true);
          transcription.disconnect();
        }
        if (encounterIdRef.current) {
          void purgeSession(encounterIdRef.current).catch(() => {});
          encounterIdRef.current = null;
        }
        return;
      }
      setPhase('recording');
    } catch (error) {
      failSessionRef.current(
        error instanceof Error ? error : new Error(String(error)),
        strings.errorConnectionFailed
      );
    }
  }, [auth, transcription, segmentRecording]);

  const handlePauseResume = useCallback(() => {
    if (phaseRef.current === 'recording') {
      pauseStreaming();
      if (modeRef.current === 'visit') {
        // App parity: pause closes (and uploads) the in-progress segment.
        void segmentRecording.pause().catch(() => {});
      }
      setPhase('paused');
    } else if (phaseRef.current === 'paused') {
      resumeStreaming();
      if (modeRef.current === 'visit') {
        void segmentRecording.resume().catch(() => {});
      }
      setPhase('recording');
    }
  }, [segmentRecording]);

  const noteReviewRef = useRef(noteReview);
  noteReviewRef.current = noteReview;

  /**
   * Successful generation tail: either hand the note straight to the host,
   * or hold it in the in-SDK review screen until the doctor approves.
   */
  const deliverNote = useCallback(
    (note: GeneratedNote, transcript: string, encounterId: string) => {
      stoppingRef.current = false;
      if (noteReviewRef.current) {
        setReviewData({ note, transcript, encounterId });
        setPhase('review');
        return;
      }
      setPhase('complete');
      onCompleteRef.current({ transcript, encounterId, note });
    },
    []
  );

  const handleApproveNote = useCallback(
    async (edited: GeneratedNote) => {
      if (!reviewData) return;
      setSavingNote(true);
      try {
        await updateNotes(auth.authorizedFetch, reviewData.encounterId, edited);
      } catch (error) {
        // The host still receives the edited note; only the server copy is
        // stale. Surface it, don't block the flow.
        console.warn(
          '[ScribeSDK] saving note edits failed:',
          error instanceof Error ? error.message : error
        );
        setBannerMessage(strings.errorNoteSave);
      }
      setSavingNote(false);
      setPhase('complete');
      onCompleteRef.current({
        transcript: reviewData.transcript,
        encounterId: reviewData.encounterId,
        note: edited,
      });
    },
    [auth, reviewData]
  );

  /** Shared failure tail: report the error, still complete with data. */
  const completeWithError = useCallback((error: unknown, transcript: string) => {
    console.warn('[ScribeSDK] session completion failed:', error instanceof Error ? error.message : error);
    setBannerMessage(strings.errorNoteGeneration);
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof NoteGenerationError && error.timedOut;
    onErrorRef.current?.(
      new NoteGenerationFailedError(
        message,
        transcript,
        encounterIdRef.current ?? undefined,
        timedOut
      )
    );
    setPhase('complete');
    stoppingRef.current = false;
    onCompleteRef.current({ transcript, encounterId: encounterIdRef.current ?? undefined });
  }, []);

  const stopVisitSession = useCallback(async () => {
    setPhase('finalizing');

    // Close the final segment FIRST (Android: stopping the streaming
    // service tears down the whole native recorder, which would orphan the
    // in-progress WAV), then stop the mic, then upload what's pending.
    try {
      await segmentRecording.finishCapture();
    } catch {
      // Capture teardown failure: continue with what we have.
    }
    stopAudioPipeline();

    let signedIds: string[] = [];
    try {
      signedIds = await segmentRecording.stop();
    } catch {
      // Continue with whatever made it up; the rest stays journaled.
    }
    const durationSeconds = Math.round(segmentRecording.getElapsedSeconds());

    setPhase('generating');
    let finalized = false;
    try {
      let encounterId = encounterIdRef.current;
      if (!encounterId) {
        throw new Error('No encounter was created for this session.');
      }
      if (isLocalEncounterId(encounterId)) {
        // Session started offline: create the real encounter now, move the
        // journal over, and give the upload queue the real id for a retry.
        const realId = await createEncounter(auth.authorizedFetch, {
          encounterMode: 'visit',
          language: auth.language,
          patientContext: patientContextRef.current,
          noteTemplateId: selectedTemplateIdRef.current || undefined,
          contextNotes: contextNotesRef.current,
        });
        await rekeySession(encounterId, realId);
        segmentRecording.setEncounterId(realId);
        encounterIdRef.current = realId;
        encounterId = realId;
        signedIds = await segmentRecording.stop();
      }
      if (signedIds.length === 0 || segmentRecording.getUnsyncedCount() > 0) {
        // Some (or all) audio never reached the server. Do NOT finalize a
        // partial visit — a note generated from audio with holes is worse
        // than a delayed one. The session stays journaled with its WAVs;
        // crash recovery uploads the rest and finalizes on a later mount.
        throw new Error(
          'The recording could not be fully uploaded. It is stored on this device and will be submitted automatically when the connection returns.'
        );
      }
      await finalizeEncounter(auth.authorizedFetch, encounterId, {
        mode: 'visit',
        transcript: '',
        durationSeconds,
        segmentKeys: signedIds,
      });
      finalized = true;
      await markFinalized(encounterId);

      const note = await noteGeneration.generate(encounterId, VISIT_GENERATION_TIMEOUT_MS);
      // The batch pipeline produced the transcript server-side; fetch it so
      // onComplete carries it like a dictation session would.
      let transcript = '';
      try {
        transcript = (await getEncounter(auth.authorizedFetch, encounterId)).customConversation ?? '';
      } catch {
        // Note delivery already succeeded; a missing transcript is cosmetic.
      }
      await purgeSession(encounterId);

      deliverNote(note, transcript, encounterId);
    } catch (error) {
      if (finalized && encounterIdRef.current) {
        // Audio is safely server-side; only note delivery failed. The local
        // journal is no longer needed.
        await purgeSession(encounterIdRef.current).catch(() => {});
      }
      completeWithError(error, '');
    }
  }, [auth, completeWithError, deliverNote, noteGeneration, segmentRecording, stopAudioPipeline]);

  const stopDictationSession = useCallback(async () => {
    setPhase('finalizing');
    transcription.setFinishing(true);
    stopAudioPipeline();

    // Keep the socket open briefly so in-flight finals can land.
    await new Promise((resolve) => setTimeout(resolve, FINALIZE_FLUSH_MS));

    const transcript = transcription.getFinalTranscript();
    const transcriptionData = buildTranscriptionData(transcriptSegmentsRef.current);
    transcription.disconnect();

    // Nothing was said: no note to generate, complete with the transcript.
    if (transcript.trim().length === 0) {
      if (encounterIdRef.current) {
        await purgeSession(encounterIdRef.current).catch(() => {});
      }
      setPhase('complete');
      stoppingRef.current = false;
      onCompleteRef.current({ transcript, encounterId: encounterIdRef.current ?? undefined });
      return;
    }

    // Journal the FINAL transcript (the 5s live sync may be behind by the
    // last few words) so crash/offline recovery never finalizes stale data.
    if (encounterIdRef.current) {
      await updateSession(encounterIdRef.current, {
        transcript,
        transcriptionData,
        durationSeconds: elapsedRef.current,
      }).catch(() => {});
    }

    // Generate the clinical note: finalize the encounter (which enqueues
    // generation server-side) and wait for the NotesChannel/polling result.
    setPhase('generating');
    let finalized = false;
    try {
      if (!encounterIdRef.current || isLocalEncounterId(encounterIdRef.current)) {
        // Creation failed (or was offline) at session start — retry now and
        // move the journal onto the real id.
        const localId = encounterIdRef.current;
        const realId = await createEncounter(auth.authorizedFetch, {
          encounterMode: 'dictation',
          language: auth.language,
          patientContext: patientContextRef.current,
          noteTemplateId: selectedTemplateIdRef.current || undefined,
          contextNotes: contextNotesRef.current,
        });
        if (localId) await rekeySession(localId, realId);
        encounterIdRef.current = realId;
      }
      const encounterId = encounterIdRef.current;
      // The update action drops prompt[transcription_data] (unpermitted);
      // /sync is the endpoint that persists the speaker/timing map, so push
      // the final state there first. Best-effort: finalize still carries the
      // plain transcript either way.
      await syncEncounter(auth.authorizedFetch, encounterId, {
        transcription_data: transcriptionData,
        custom_conversation: transcript,
        duration: elapsedRef.current,
      }).catch(() => {});
      await finalizeEncounter(auth.authorizedFetch, encounterId, {
        mode: 'dictation',
        transcript,
        transcriptionData,
        durationSeconds: elapsedRef.current,
      });
      finalized = true;
      await markFinalized(encounterId);
      const note = await noteGeneration.generate(encounterId, DICTATION_GENERATION_TIMEOUT_MS);
      await purgeSession(encounterId);

      deliverNote(note, transcript, encounterId);
    } catch (error) {
      if (finalized && encounterIdRef.current) {
        // The transcript reached the server; the local journal is done.
        await purgeSession(encounterIdRef.current).catch(() => {});
      }
      completeWithError(error, transcript);
    }
  }, [auth, completeWithError, deliverNote, noteGeneration, stopAudioPipeline, transcription]);

  const handleStop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (modeRef.current === 'visit') {
      await stopVisitSession();
    } else {
      await stopDictationSession();
    }
  }, [stopDictationSession, stopVisitSession]);

  const performCancel = useCallback(() => {
    sessionGenRef.current++;
    stopAudioPipeline();
    transcription.setFinishing(true);
    transcription.disconnect();
    transcription.reset();
    if (modeRef.current === 'visit') {
      void segmentRecording.abort().catch(() => {});
    }
    if (encounterIdRef.current) {
      // Explicit cancel: the user does not want this session recovered.
      void purgeSession(encounterIdRef.current).catch(() => {});
      encounterIdRef.current = null;
    }
    setElapsedSeconds(0);
    setBannerMessage(null);
    setPhase('idle');
    onCancelRef.current?.();
  }, [segmentRecording, stopAudioPipeline, transcription]);

  const handleCancel = useCallback(() => {
    // Cancelling a live recording is destructive — confirm with the
    // discard warning. Everything else still confirms, just more lightly:
    // a stray tap on the close button should never eject the doctor.
    if (phaseRef.current === 'recording' || phaseRef.current === 'paused') {
      Alert.alert(strings.discardTitle, strings.discardMessage, [
        { text: strings.discardKeep, style: 'cancel' },
        { text: strings.discardConfirm, style: 'destructive', onPress: performCancel },
      ]);
      return;
    }
    Alert.alert(strings.closeTitle, undefined, [
      { text: strings.closeKeep, style: 'cancel' },
      { text: strings.closeConfirm, onPress: performCancel },
    ]);
  }, [performCancel]);

  // Host-driven close: same confirmations/discard logic as the SDK's ✕.
  useImperativeHandle(ref, () => ({ requestClose: handleCancel }), [handleCancel]);

  // Auto-start (web-widget parity): begin recording as soon as auth is
  // ready. Waits briefly for user config so the session starts in the
  // clinician's default mode; starts anyway if the config never loads.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || auth.status !== 'ready') return;
    const delay = userConfig != null ? 0 : 2_500;
    const timer = setTimeout(() => {
      if (autoStartedRef.current || phaseRef.current !== 'idle') return;
      autoStartedRef.current = true;
      void handleStart();
    }, delay);
    return () => clearTimeout(timer);
  }, [autoStart, auth.status, userConfig, handleStart]);

  const handleModeChange = useCallback((nextMode: EncounterMode) => {
    modeTouchedRef.current = true;
    setMode(nextMode);
  }, []);

  // Context edited DURING a session syncs debounced (app parity: 2s) and
  // is journaled for crash recovery.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = setTimeout(() => {
      const encounterId = encounterIdRef.current;
      if (!encounterId) return;
      void updateSession(encounterId, { contextNotes: contextNotes || undefined });
      if (!isLocalEncounterId(encounterId)) {
        void syncEncounter(authRef.current.authorizedFetch, encounterId, {
          current_notes_text: contextNotes,
        }).catch(() => {});
      }
    }, 2_000);
    return () => clearTimeout(timer);
  }, [contextNotes, phase]);

  const handleTemplateSelect = useCallback((templateId: string) => {
    templateTouchedRef.current = true;
    setSelectedTemplateId(templateId);
    const encounterId = encounterIdRef.current;
    if (encounterId && !isLocalEncounterId(encounterId)) {
      void syncEncounter(authRef.current.authorizedFetch, encounterId, {
        note_template_id: templateId,
      }).catch(() => {});
      void updateSession(encounterId, { noteTemplateId: templateId || undefined });
    }
  }, []);

  // Map internal phase + connection state onto the status pill. Visit mode
  // has no live socket — recording is always 'listening'.
  let pillStatus: SessionStatus | null = null;
  if (phase === 'starting') pillStatus = 'connecting';
  else if (phase === 'paused') pillStatus = 'paused';
  else if (phase === 'finalizing') pillStatus = 'finalizing';
  else if (phase === 'generating') pillStatus = 'generating';
  else if (phase === 'recording') {
    pillStatus =
      mode === 'visit' || transcription.connectionState === 'connected'
        ? 'listening'
        : 'reconnecting';
  }

  const showCancel =
    Boolean(onCancel) &&
    (phase === 'idle' ||
      phase === 'starting' ||
      phase === 'recording' ||
      phase === 'paused' ||
      phase === 'error');
  const isSessionLive = phase === 'recording' || phase === 'paused';

  return (
    <ThemeContext.Provider value={themePalette}>
    <View
      style={[
        styles.card,
        {
          backgroundColor: themePalette.background,
          // Safe area: never less than the base card padding, always clears
          // the status bar / dynamic island and the home indicator.
          paddingTop: Math.max(spacing.lg, insets.top + spacing.sm),
          paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm),
        },
      ]}>
      {/* Live header (app parity): compact timer left, patient + close right.
          The full title header renders on idle/generating/complete/error. */}
      {isSessionLive ? (
        <View style={styles.liveHeader}>
          <Timer seconds={elapsedSeconds} running={phase === 'recording'} />
          {!hideHeader && (
          <View style={styles.liveHeaderRight}>
            {patientContext?.patientId != null && (
              <View style={[styles.contextChip, { backgroundColor: themePalette.surface }]}>
                <TablerIcon name="user" size={13} color={themePalette.textSecondary} />
                <Text style={[styles.contextChipText, themedText.secondary]}>
                  {patientContext.patientId}
                </Text>
              </View>
            )}
            {showCancel && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.cancel}
                accessibilityHint={strings.discardTitle}
                onPress={handleCancel}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.cancelCircle,
                  { backgroundColor: themePalette.surface },
                  pressed && { opacity: 0.7 },
                ]}>
                <TablerIcon name="x" size={16} color={themePalette.textSecondary} />
              </Pressable>
            )}
          </View>
          )}
        </View>
      ) : hideHeader ? null : (
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, themedText.title]}>
            {phase === 'review' ? strings.reviewNoteTitle : strings.sessionTitle}
          </Text>
          {patientContext && (
            <View style={styles.contextChips}>
              {patientContext.patientId != null && (
                <View style={[styles.contextChip, { backgroundColor: themePalette.surface }]}>
                  <TablerIcon name="user" size={13} color={themePalette.textSecondary} />
                  <Text style={[styles.contextChipText, themedText.secondary]}>
                    {strings.patientLabel} · {patientContext.patientId}
                  </Text>
                </View>
              )}
              {patientContext.medicalRecord != null && (
                <View style={[styles.contextChip, { backgroundColor: themePalette.surface }]}>
                  <Text style={[styles.contextChipText, themedText.secondary]}>
                    {strings.medicalRecordLabel} · {patientContext.medicalRecord}
                  </Text>
                </View>
              )}
              {patientContext.timestamp != null && (
                <View style={[styles.contextChip, { backgroundColor: themePalette.surface }]}>
                  <Text style={[styles.contextChipText, themedText.secondary]}>
                    {strings.timestampLabel} · {patientContext.timestamp}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        {showCancel && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.cancel}
            accessibilityHint={strings.discardTitle}
            onPress={handleCancel}
            hitSlop={10}
            style={({ pressed }) => [
              styles.cancelCircle,
              { backgroundColor: themePalette.surface },
              pressed && { opacity: 0.7 },
            ]}>
            <TablerIcon name="x" size={16} color={themePalette.textSecondary} />
          </Pressable>
        )}
      </View>
      )}

      {/* The pill only earns its place for transitional states — while
          recording, the timer dot + waveform already say "listening". */}
      {!booting && (pillStatus === 'connecting' || pillStatus === 'reconnecting') && (
        <View style={styles.pillRow}>
          <StatusPill status={pillStatus} />
        </View>
      )}

      {/* Boot: skeleton mirroring the idle layout until auth + user config
          are ready — the real screen then appears fully formed. */}
      {booting && <IdleSkeleton />}

      {bannerMessage != null && (
        <ErrorBanner message={bannerMessage} onDismiss={() => setBannerMessage(null)} />
      )}

      {/* Preflight: required config (token) missing/invalid — don't render
          the recording UI, tell the doctor exactly what's needed. */}
      {needsSetup && (
        <View style={styles.centered}>
          <View
            style={[styles.setupBadge, { backgroundColor: withAlpha(themePalette.accent, 0.1) }]}>
            <TablerIcon name="user" size={26} color={themePalette.accent} />
          </View>
          <Text style={[styles.setupTitle, themedText.title]}>{strings.setupRequiredTitle}</Text>
          <Text style={[styles.setupMessage, themedText.secondary]}>
            {errorMessage ?? strings.setupRequiredMessage}
          </Text>
          {onConfigure && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.openSettings}
              onPress={onConfigure}
              style={({ pressed }) => [
                styles.setupButton,
                { backgroundColor: themePalette.accent },
                pressed && styles.retryPressed,
              ]}>
              <Text style={styles.setupButtonLabel}>{strings.openSettings}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Body */}
      {!booting && !needsSetup && (phase === 'idle' || phase === 'starting') && (
        <View style={styles.setupArea}>
          {phase === 'idle' && userConfig?.encounterModesEnabled && (
            <ModeToggle mode={mode} onChange={handleModeChange} />
          )}
          {phase === 'idle' &&
            !noteTemplateLocked &&
            userConfig != null &&
            userConfig.noteTemplates.length > 0 && (
              <TemplatePicker
                templates={userConfig.noteTemplates}
                selectedId={selectedTemplateId}
                onSelect={handleTemplateSelect}
                language={auth.language}
              />
            )}
          {phase === 'idle' && (
            <ContextInput value={contextNotes} onChange={setContextNotes} language={auth.language} />
          )}
          <View style={styles.centered}>
            <RecordButton
              state={phase === 'starting' ? 'busy' : 'idle'}
              onPress={handleStart}
              disabled={auth.status !== 'ready'}
            />
            <Text style={[styles.hint, themedText.muted]}>
              {phase === 'starting'
                ? strings.connectingHint
                : auth.status === 'initializing'
                  ? strings.errorAuthNotReady
                  : strings.idleHint}
            </Text>
          </View>
        </View>
      )}

      {/* One continuous staged screen from the moment the doctor finishes:
          finalizing (flush/upload) is stage 1, so no interstitial dots. */}
      {(phase === 'finalizing' || phase === 'generating') && (
        <View style={styles.liveArea}>
          <GenerationProgress
            mode={mode}
            finalizing={phase === 'finalizing'}
            serverStatus={noteGeneration.serverStatus}
            receiving={noteGeneration.progressChars > 0}
          />
        </View>
      )}

      {phase === 'review' && reviewData != null && (
        <NoteReview
          note={reviewData.note}
          language={auth.language}
          saving={savingNote}
          onApprove={handleApproveNote}
        />
      )}

      {isSessionLive && (
        <View style={styles.liveArea}>
          {/* Details (app parity: EncounterDetails) — template + context stay
              editable during the recording. */}
          {!noteTemplateLocked &&
            userConfig != null &&
            userConfig.noteTemplates.length > 0 && (
              <TemplatePicker
                templates={userConfig.noteTemplates}
                selectedId={selectedTemplateId}
                onSelect={handleTemplateSelect}
                language={auth.language}
              />
            )}
          <ContextInput
            value={contextNotes}
            onChange={setContextNotes}
            language={auth.language}
          />

          {/* Main area (app parity): dictation shows ONLY the transcript,
              visit shows ONLY the tall waveform. */}
          {mode === 'dictation' ? (
            <TranscriptView
              segments={transcription.segments}
              interimText={transcription.interimText}
              language={auth.language}
              paused={phase === 'paused'}
            />
          ) : (
            <View style={styles.centeredGrow}>
              <Waveform levels={levels} paused={phase !== 'recording'} height={128} />
            </View>
          )}

          <Controls
            paused={phase === 'paused'}
            onPauseResume={handlePauseResume}
            onStop={handleStop}
            language={auth.language}
            finishControl={finishControl}
          />
        </View>
      )}

      {phase === 'complete' && (
        <View style={styles.centered}>
          <CompleteBadge accent={themePalette.accent} />
          <Text style={[styles.completeText, themedText.secondary]}>{strings.sessionComplete}</Text>
        </View>
      )}

      {(phase === 'idle' || phase === 'complete') && (
        <Text style={[styles.brandFooter, themedText.muted]}>{strings.poweredBy}</Text>
      )}

      {phase === 'error' && (
        <View style={styles.centered}>
          <Text style={[styles.errorTitle, themedText.title]}>{strings.errorTitle}</Text>
          {errorMessage != null && (
            <Text style={[styles.errorDetail, themedText.secondary]}>{errorMessage}</Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.retry}
            onPress={handleStart}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: themePalette.accent },
              pressed && styles.retryPressed,
            ]}>
            <Text style={styles.retryLabel}>{strings.retry}</Text>
          </Pressable>
        </View>
      )}
    </View>
    </ThemeContext.Provider>
  );
  }
);

/** Success badge that springs in — a small moment of completion. */
function CompleteBadge({ accent }: { accent: string }): React.ReactElement {
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [scale]);
  return (
    <Animated.View
      style={[
        styles.completeBadge,
        { backgroundColor: withAlpha(accent, 0.1), transform: [{ scale }] },
      ]}>
      <View style={[styles.completeCheck, { borderColor: accent }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.background,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.textPrimary,
    letterSpacing: -0.3,
  },
  contextChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  contextChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  cancelCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  liveHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  setupArea: {
    flex: 1,
    gap: spacing.lg,
  },
  centeredGrow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Visit-mode recording presence: soft accent panel + listening halo.
  visitPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    borderRadius: radii.panel,
  },
  visitHalo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitHint: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  completeBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
    textAlign: 'center',
  },
  setupMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.md,
  },
  setupButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  setupButtonLabel: {
    color: palette.onAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  // Check mark built from borders (no icon dependency).
  completeCheck: {
    width: 22,
    height: 12,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }, { translateY: -2 }],
  },
  brandFooter: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: palette.textMuted,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: palette.textMuted,
    textAlign: 'center',
  },
  liveArea: {
    flex: 1,
    gap: spacing.lg,
  },
  finalizingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
  },
  completeText: {
    fontSize: 16,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: palette.textPrimary,
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 14,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  // Accent applied inline from the resolved theme.
  retryButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
  },
  retryPressed: {
    opacity: 0.85,
  },
  retryLabel: {
    color: palette.onAccent,
    fontSize: 15,
    fontWeight: '600',
  },
});
