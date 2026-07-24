/**
 * Crash recovery: finalize sessions that were interrupted by process death.
 *
 * ScribeMDProvider runs this sweep once auth is ready. For every pending
 * (unfinalized) session in the offline manifest it uploads any unsynced
 * segment WAVs, finalizes the encounter server-side (visit -> batch
 * transcription; dictation -> note generation from the last synced
 * transcript), and purges the local files. Best-effort and headless: a
 * failure leaves the session pending for the next mount.
 */
import { uploadSegmentFile } from './api/directUpload';
import { createEncounter, finalizeEncounter, type AuthorizedFetch } from './api/encounters';
import { syncEncounter } from './api/sync';
import {
  isLocalEncounterId,
  listPendingSessions,
  markFinalized,
  markSegmentSynced,
  purgeSession,
  rekeySession,
  type StoredSession,
} from './storage/sessionStore';
import { fileExists } from './storage/fileSystem';

async function uploadRemainingSegments(
  authorizedFetch: AuthorizedFetch,
  session: StoredSession
): Promise<void> {
  const pending = session.segments
    .filter((segment) => !segment.synced)
    .sort((a, b) => a.index - b.index);
  for (const segment of pending) {
    if (!segment.signedId && !fileExists(segment.fileUri)) {
      continue; // WAV lost (OS cleanup) — recover the rest.
    }
    if (!segment.signedId) {
      segment.signedId = await uploadSegmentFile(authorizedFetch, segment.fileUri);
    }
    await syncEncounter(authorizedFetch, session.encounterId, {
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
    await markSegmentSynced(session.encounterId, segment.index, segment.signedId);
  }
}

async function recoverSession(
  authorizedFetch: AuthorizedFetch,
  session: StoredSession
): Promise<boolean> {
  const hasSegments = session.segments.length > 0;
  const hasTranscript = (session.transcript ?? '').trim().length > 0;
  if (!hasSegments && !hasTranscript) {
    // Nothing recoverable was captured — just clean up.
    await purgeSession(session.encounterId);
    return false;
  }

  // The session started offline and never got a backend encounter — create
  // one now and move the local manifest entry to the real id.
  if (isLocalEncounterId(session.encounterId)) {
    const encounterId = await createEncounter(authorizedFetch, {
      encounterMode: session.mode,
      language: session.language,
      noteTemplateId: session.noteTemplateId,
      contextNotes: session.contextNotes,
    });
    await rekeySession(session.encounterId, encounterId);
    session = { ...session, encounterId };
  }

  if (session.mode === 'visit') {
    await uploadRemainingSegments(authorizedFetch, session);
    const signedIds = session.segments
      .filter((segment) => segment.synced && segment.signedId)
      .sort((a, b) => a.index - b.index)
      .map((segment) => segment.signedId!);
    if (signedIds.length === 0) {
      await purgeSession(session.encounterId);
      return false;
    }
    await finalizeEncounter(authorizedFetch, session.encounterId, {
      mode: 'visit',
      transcript: '',
      durationSeconds: session.durationSeconds,
      segmentKeys: signedIds,
    });
  } else {
    // /sync persists the speaker/timing map (the update action drops
    // prompt[transcription_data]); finalize then triggers note generation.
    if (session.transcriptionData) {
      await syncEncounter(authorizedFetch, session.encounterId, {
        transcription_data: session.transcriptionData,
        custom_conversation: session.transcript ?? '',
        duration: session.durationSeconds,
      }).catch(() => {});
    }
    await finalizeEncounter(authorizedFetch, session.encounterId, {
      mode: 'dictation',
      transcript: session.transcript ?? '',
      transcriptionData: session.transcriptionData,
      durationSeconds: session.durationSeconds,
    });
  }

  await markFinalized(session.encounterId);
  await purgeSession(session.encounterId);
  return true;
}

/**
 * Run the recovery sweep. Returns the encounter ids that were finalized.
 * Never throws: failed sessions stay pending for the next mount.
 */
export async function recoverPendingSessions(
  authorizedFetch: AuthorizedFetch,
  onSessionRecovered?: (encounterId: string) => void,
  /**
   * Only recover sessions created before this ISO timestamp — the provider
   * passes its mount time so a session that just started in THIS process is
   * never swept up mid-recording.
   */
  onlyCreatedBefore?: string
): Promise<string[]> {
  const recovered: string[] = [];
  let pending: StoredSession[] = [];
  try {
    pending = await listPendingSessions();
  } catch {
    return recovered;
  }
  if (onlyCreatedBefore) {
    pending = pending.filter((session) => session.createdAt < onlyCreatedBefore);
  }
  for (const session of pending) {
    try {
      if (await recoverSession(authorizedFetch, session)) {
        recovered.push(session.encounterId);
        onSessionRecovered?.(session.encounterId);
      }
    } catch (error) {
      // Leave this session pending; retried on the next mount.
      console.warn(
        `[ScribeSDK] recovery of session ${session.encounterId} failed (will retry next mount):`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return recovered;
}
