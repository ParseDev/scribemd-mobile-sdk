/**
 * Visit-mode audio pipeline: rolling WAV segment files, rotated every 20s
 * (and on pause), each uploaded via Rails direct upload and attached to the
 * encounter through /sync — a port of the app's createAndUploadSegment +
 * segmentUploadQueue with the same ordering/idempotency guarantees, backed
 * by the offline session manifest instead of AsyncStorage.
 *
 * The caller (ScribeSession) owns startStreaming/stopStreaming — the PCM
 * stream powers the waveform and the Android foreground service in both
 * modes; this hook only manages the segment files and their uploads.
 *
 * All capture operations (start/rotate/pause/resume/finish/abort) run on
 * ONE serial chain: the native module has a single implicit file-recording
 * slot, so an interleaved stop-during-rotate would drop the final segment
 * and leak a live native recording into the next session.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { uploadSegmentFile } from '../api/directUpload';
import { syncEncounter } from '../api/sync';
import type { AuthorizedFetch } from '../api/encounters';
import { startFileRecording, stopFileRecording } from '../microphone';
import { deleteFile } from '../storage/fileSystem';
import {
  markSegmentSynced,
  segmentsDirectoryUri,
  upsertSegment,
  type StoredSegment,
} from '../storage/sessionStore';

/** App parity: encounter-recording.tsx rotates segments every 20 seconds. */
const SEGMENT_ROTATION_MS = 20_000;
/** Spacing between queued uploads (app parity: 100-200ms). */
const UPLOAD_SPACING_MS = 150;
/** Stay well below the backend's MAX_AUDIO_SEGMENTS (500) hard cap. */
export const MAX_SEGMENTS = 480;

export interface UseSegmentRecordingOptions {
  authorizedFetch: AuthorizedFetch;
  /** Non-fatal upload/sync failure — surface a banner, recording continues. */
  onUploadError?: (error: Error) => void;
  /** The backend segment cap is about to be hit; caller should stop. */
  onSegmentLimit?: () => void;
}

export interface UseSegmentRecordingResult {
  start: (encounterId: string) => Promise<void>;
  /** Swap in the real backend id after an offline (local-...) start. */
  setEncounterId: (encounterId: string) => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /**
   * Close the in-progress segment and end capture WITHOUT uploading —
   * lets the caller stop the mic before the (potentially slow) uploads.
   */
  finishCapture: () => Promise<void>;
  /** Upload everything pending, return synced signed_ids in order. */
  stop: () => Promise<string[]>;
  /** Segments recorded but not yet attached to the encounter server-side. */
  getUnsyncedCount: () => number;
  /** Abandon the session: stop recording, delete the in-progress file. */
  abort: () => Promise<void>;
  /** Total seconds of recorded audio across all segments so far. */
  getElapsedSeconds: () => number;
}

interface SegmentState extends StoredSegment {}

export function useSegmentRecording(
  options: UseSegmentRecordingOptions
): UseSegmentRecordingResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const encounterIdRef = useRef<string | null>(null);
  const segmentsRef = useRef<SegmentState[]>([]);
  const nextIndexRef = useRef(0);
  const currentStartMsRef = useRef<number | null>(null);
  const closedDurationRef = useRef(0); // seconds across closed segments
  const rotationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRecordingRef = useRef(false);
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const opChainRef = useRef<Promise<void>>(Promise.resolve());
  const stoppedRef = useRef(true);
  const limitNotifiedRef = useRef(false);

  /** Serialize capture operations; errors propagate to the caller only. */
  const runExclusive = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = opChainRef.current.then(operation, operation);
    opChainRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }, []);

  const getElapsedSeconds = useCallback(() => {
    const current =
      currentStartMsRef.current != null ? (Date.now() - currentStartMsRef.current) / 1000 : 0;
    return closedDurationRef.current + current;
  }, []);

  const getUnsyncedCount = useCallback(
    () => segmentsRef.current.filter((segment) => !segment.synced).length,
    []
  );

  const clearRotationTimer = useCallback(() => {
    if (rotationTimerRef.current) {
      clearInterval(rotationTimerRef.current);
      rotationTimerRef.current = null;
    }
  }, []);

  /** Upload one segment (direct upload + /sync attach); idempotent. */
  const uploadSegment = useCallback(async (segment: SegmentState): Promise<void> => {
    const encounterId = encounterIdRef.current;
    if (!encounterId || segment.synced) return;

    const { authorizedFetch } = optionsRef.current;
    if (!segment.signedId) {
      segment.signedId = await uploadSegmentFile(authorizedFetch, segment.fileUri);
    }
    // Sync failure is non-fatal (app parity): the signed_id is kept and the
    // segment is re-synced by a later upload pass or the finalize sweep.
    await syncEncounter(authorizedFetch, encounterId, {
      segments: [
        {
          signed_id: segment.signedId,
          segment_index: segment.index,
          duration: segment.duration,
          start_time: segment.startTime,
          end_time: segment.endTime,
          total_duration: segment.totalDuration,
        },
      ],
      duration: segment.totalDuration,
    });
    segment.synced = true;
    await markSegmentSynced(encounterId, segment.index, segment.signedId);
  }, []);

  /**
   * Queue upload of all currently-unsynced segments in index order. All
   * uploads run on one serial chain so ordering is preserved even when
   * rotations outpace uploads.
   */
  const queuePendingUploads = useCallback((): Promise<void> => {
    uploadChainRef.current = uploadChainRef.current.then(async () => {
      const pending = segmentsRef.current
        .filter((segment) => !segment.synced)
        .sort((a, b) => a.index - b.index);
      for (const segment of pending) {
        try {
          await uploadSegment(segment);
        } catch (error) {
          console.warn(
            `[ScribeSDK] segment ${segment.index} upload failed (kept for retry):`,
            error instanceof Error ? error.message : error
          );
          optionsRef.current.onUploadError?.(
            error instanceof Error ? error : new Error(String(error))
          );
          // Keep going: later segments may still upload (app parity).
        }
        await new Promise((resolve) => setTimeout(resolve, UPLOAD_SPACING_MS));
      }
    });
    return uploadChainRef.current;
  }, [uploadSegment]);

  const startSegmentFile = useCallback(async (): Promise<void> => {
    const encounterId = encounterIdRef.current;
    if (!encounterId) return;
    const index = nextIndexRef.current;
    const path = `${segmentsDirectoryUri()}/seg_${encounterId}_${index}_${Date.now()}.wav`;
    await startFileRecording(path);
    fileRecordingRef.current = true;
    currentStartMsRef.current = Date.now();
  }, []);

  /** Close the in-progress segment file and queue its upload. */
  const closeCurrentSegment = useCallback(async (): Promise<void> => {
    if (!fileRecordingRef.current || currentStartMsRef.current == null) return;
    const encounterId = encounterIdRef.current;
    const startedAtMs = currentStartMsRef.current;
    currentStartMsRef.current = null;
    fileRecordingRef.current = false;

    const filePath = await stopFileRecording();
    const duration = (Date.now() - startedAtMs) / 1000;
    if (!filePath) return;
    // Native returns a plain path; expo-file-system requires a file:// URI.
    const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    // Discard sub-250ms slivers (e.g. rapid pause after a rotation) — and
    // delete the file so orphans don't accumulate in Documents.
    if (!encounterId || duration < 0.25) {
      deleteFile(fileUri);
      return;
    }

    const index = nextIndexRef.current++;
    const startTime = closedDurationRef.current;
    closedDurationRef.current += duration;
    const segment: SegmentState = {
      index,
      fileUri,
      duration,
      startTime,
      endTime: closedDurationRef.current,
      totalDuration: closedDurationRef.current,
      synced: false,
    };
    segmentsRef.current.push(segment);
    await upsertSegment(encounterId, segment);

    if (segmentsRef.current.length >= MAX_SEGMENTS && !limitNotifiedRef.current) {
      limitNotifiedRef.current = true;
      optionsRef.current.onSegmentLimit?.();
    }
    void queuePendingUploads();
  }, [queuePendingUploads]);

  /** Rotate: close the current segment and immediately start the next. */
  const rotate = useCallback((): Promise<void> => {
    return runExclusive(async () => {
      if (stoppedRef.current) return;
      await closeCurrentSegment();
      // Re-check: stop()/abort() may have run while the segment was closing.
      if (!stoppedRef.current && segmentsRef.current.length < MAX_SEGMENTS) {
        await startSegmentFile();
      }
    });
  }, [closeCurrentSegment, runExclusive, startSegmentFile]);

  const startRotationTimer = useCallback(() => {
    clearRotationTimer();
    rotationTimerRef.current = setInterval(() => {
      rotate().catch((error) => {
        optionsRef.current.onUploadError?.(
          error instanceof Error ? error : new Error(String(error))
        );
      });
    }, SEGMENT_ROTATION_MS);
  }, [clearRotationTimer, rotate]);

  const start = useCallback(
    (encounterId: string): Promise<void> => {
      return runExclusive(async () => {
        encounterIdRef.current = encounterId;
        segmentsRef.current = [];
        nextIndexRef.current = 0;
        closedDurationRef.current = 0;
        limitNotifiedRef.current = false;
        stoppedRef.current = false;
        uploadChainRef.current = Promise.resolve();
        await startSegmentFile();
        startRotationTimer();
      });
    },
    [runExclusive, startSegmentFile, startRotationTimer]
  );

  // App parity: pausing closes (and uploads) the in-progress segment.
  const pause = useCallback((): Promise<void> => {
    clearRotationTimer();
    return runExclusive(() => closeCurrentSegment());
  }, [clearRotationTimer, closeCurrentSegment, runExclusive]);

  const resume = useCallback((): Promise<void> => {
    return runExclusive(async () => {
      if (stoppedRef.current) return;
      await startSegmentFile();
      startRotationTimer();
    });
  }, [runExclusive, startSegmentFile, startRotationTimer]);

  /** End capture (close final segment), without waiting for uploads. */
  const finishCapture = useCallback((): Promise<void> => {
    stoppedRef.current = true;
    clearRotationTimer();
    return runExclusive(() => closeCurrentSegment());
  }, [clearRotationTimer, closeCurrentSegment, runExclusive]);

  const stop = useCallback(async (): Promise<string[]> => {
    await finishCapture();
    await queuePendingUploads();
    return segmentsRef.current
      .filter((segment) => segment.synced && segment.signedId)
      .sort((a, b) => a.index - b.index)
      .map((segment) => segment.signedId!);
  }, [finishCapture, queuePendingUploads]);

  const setEncounterId = useCallback((encounterId: string) => {
    encounterIdRef.current = encounterId;
  }, []);

  // JS timers suspend while backgrounded (notably Android, despite the
  // foreground service keeping capture alive). Catch up on foreground
  // return: if the current segment overran the rotation window, rotate now
  // (app parity: encounter-recording's foreground-return rotation).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!rotationTimerRef.current || currentStartMsRef.current == null) return;
      if (Date.now() - currentStartMsRef.current >= SEGMENT_ROTATION_MS) {
        rotate().catch((error) => {
          optionsRef.current.onUploadError?.(
            error instanceof Error ? error : new Error(String(error))
          );
        });
      }
    });
    return () => subscription.remove();
  }, [rotate]);

  const abort = useCallback((): Promise<void> => {
    stoppedRef.current = true;
    clearRotationTimer();
    return runExclusive(async () => {
      if (fileRecordingRef.current) {
        fileRecordingRef.current = false;
        currentStartMsRef.current = null;
        try {
          const filePath = await stopFileRecording();
          // The aborted in-progress file is never uploaded — remove it.
          if (filePath) {
            deleteFile(filePath.startsWith('file://') ? filePath : `file://${filePath}`);
          }
        } catch {
          // Nothing recording.
        }
      }
      encounterIdRef.current = null;
      segmentsRef.current = [];
    });
  }, [clearRotationTimer, runExclusive]);

  return {
    start,
    setEncounterId,
    pause,
    resume,
    finishCapture,
    stop,
    getUnsyncedCount,
    abort,
    getElapsedSeconds,
  };
}
