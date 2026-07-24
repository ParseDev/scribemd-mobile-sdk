/**
 * POST /api/v1/encounters/:id/sync — the app's unified incremental-update
 * endpoint. Accepts partial `{encounter: {...}}` bodies; segment attachment
 * is idempotent by signed_id server-side.
 *
 * Port of syncEncounter from the app's services/encounterSync.ts, including
 * its retry policy: 3 retries, exponential backoff 1s -> 10s, retrying only
 * network errors, 429 and 5xx.
 */
import type { AuthorizedFetch } from './encounters';

export interface SyncSegment {
  signed_id: string;
  segment_index: number;
  duration: number;
  start_time: number;
  end_time: number;
  total_duration: number;
}

export interface EncounterSyncData {
  patient_id?: string;
  note_template_id?: string;
  current_notes_text?: string;
  duration?: number;
  start_time?: string;
  /** JSON string map {id: {text, speaker, start_time}}. */
  transcription_data?: string;
  custom_conversation?: string;
  segments?: SyncSegment[];
}

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export async function syncEncounter(
  authorizedFetch: AuthorizedFetch,
  encounterId: string,
  updates: EncounterSyncData
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(INITIAL_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS));
    }
    try {
      const response = await authorizedFetch(`/api/v1/encounters/${encounterId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounter: updates }),
      });
      if (response.ok) return;

      const error = new Error(`Failed to sync encounter (${response.status})`);
      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        lastError = error;
        continue;
      }
      throw error;
    } catch (error) {
      // fetch() rejects only on network-level failures — retryable.
      const wrapped = error instanceof Error ? error : new Error(String(error));
      if (wrapped.message.startsWith('Failed to sync encounter')) {
        throw wrapped; // Non-retryable HTTP failure from above.
      }
      lastError = wrapped;
      if (attempt === MAX_RETRIES) throw wrapped;
    }
  }

  if (lastError) throw lastError;
}
