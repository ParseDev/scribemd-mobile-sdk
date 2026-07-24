import { createConsumer } from '@rails/actioncable';
import { useCallback, useEffect, useRef, useState } from 'react';

import { extractGeneratedNote, getEncounter, type GeneratedNote } from '../api/encounters';
import { useScribeMDAuth } from '../auth/ScribeMDProvider';

// Trimmed port of the ScribeMD mobile app's EncounterNotes logic:
// ActionCable NotesChannel for the live 'finished' signal, with a REST
// polling fallback in case the socket never delivers.
const POLL_INTERVAL_MS = 5_000;
const POLL_INITIAL_DELAY_MS = 5_000;
/** Default budget before falling back to the transcript (dictation). */
const GENERATION_TIMEOUT_MS = 180_000;

export type NoteGenerationStatus = 'idle' | 'generating' | 'finished' | 'error';

export class NoteGenerationError extends Error {
  /** True when generation did not finish within the 3 minute budget. */
  readonly timedOut: boolean;

  constructor(message: string, timedOut = false) {
    super(message);
    this.name = 'NoteGenerationError';
    this.timedOut = timedOut;
  }
}

export interface UseNoteGenerationResult {
  status: NoteGenerationStatus;
  /** Characters of streamed note received so far (subtle progress signal). */
  progressChars: number;
  /**
   * Last summary_status observed from the server while generating —
   * 'waiting' (visit: batch transcription in progress) or 'running'
   * (note generation in progress). Drives the staged progress UI.
   */
  serverStatus: string | null;
  /** The finished note, once status === 'finished'. */
  note: GeneratedNote | null;
  /**
   * Wait for the encounter's note to finish generating. Resolves with the
   * note; rejects with NoteGenerationError on failure/timeout/cancel.
   * Visit mode passes a larger `timeoutMs` budget (batch transcription
   * happens server-side before generation starts).
   */
  generate: (encounterId: string, timeoutMs?: number) => Promise<GeneratedNote>;
  /** Abort an in-flight generate(). Safe to call when idle. */
  cancel: () => void;
}

// ActionCable expects browser-style global event listeners (it registers a
// visibilitychange handler); React Native has none, so install inert ones.
function installGlobalEventListenerPolyfill(): void {
  const globalAny = globalThis as Record<string, unknown>;
  if (typeof globalAny.addEventListener === 'function') return;
  const listeners: { [eventName: string]: Set<(event: unknown) => void> } = {};
  globalAny.addEventListener = (eventName: string, callback: (event: unknown) => void) => {
    (listeners[eventName] ??= new Set()).add(callback);
  };
  globalAny.removeEventListener = (eventName: string, callback?: (event: unknown) => void) => {
    if (!listeners[eventName]) return;
    if (callback) listeners[eventName].delete(callback);
    else listeners[eventName].clear();
  };
  globalAny.dispatchEvent = (event: { type: string }) => {
    listeners[event.type]?.forEach((callback) => callback(event));
    return true;
  };
}

interface CableSubscriptionLike {
  unsubscribe(): void;
}

interface CableConsumerLike {
  disconnect(): void;
}

export function useNoteGeneration(): UseNoteGenerationResult {
  const auth = useScribeMDAuth();
  const authRef = useRef(auth);
  authRef.current = auth;

  const [status, setStatus] = useState<NoteGenerationStatus>('idle');
  const [progressChars, setProgressChars] = useState(0);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [note, setNote] = useState<GeneratedNote | null>(null);

  const cancelRef = useRef<() => void>(() => {});

  const generate = useCallback(async (
    encounterId: string,
    timeoutMs: number = GENERATION_TIMEOUT_MS
  ): Promise<GeneratedNote> => {
    cancelRef.current(); // tear down any previous run
    setStatus('generating');
    setProgressChars(0);
    setServerStatus(null);
    setNote(null);

    return new Promise<GeneratedNote>((resolve, reject) => {
      let settled = false;
      let consumer: CableConsumerLike | null = null;
      let subscription: CableSubscriptionLike | null = null;
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollStartTimeout: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let checking = false;

      const cleanup = () => {
        if (pollStartTimeout) clearTimeout(pollStartTimeout);
        pollStartTimeout = null;
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = null;
        try {
          subscription?.unsubscribe();
        } catch {
          // Already gone.
        }
        subscription = null;
        try {
          consumer?.disconnect();
        } catch {
          // Already gone.
        }
        consumer = null;
        cancelRef.current = () => {};
      };

      const succeed = (finishedNote: GeneratedNote) => {
        if (settled) return;
        settled = true;
        cleanup();
        setNote(finishedNote);
        setStatus('finished');
        resolve(finishedNote);
      };

      const fail = (error: NoteGenerationError) => {
        if (settled) return;
        settled = true;
        cleanup();
        setStatus('error');
        reject(error);
      };

      cancelRef.current = () => {
        fail(new NoteGenerationError('Note generation cancelled.'));
      };

      // Fetch the encounter and settle if generation reached a terminal state.
      const check = async () => {
        if (settled || checking) return;
        checking = true;
        try {
          const snapshot = await getEncounter(authRef.current.authorizedFetch, encounterId);
          if (snapshot.summaryStatus) setServerStatus(snapshot.summaryStatus);
          if (snapshot.summaryStatus === 'finished') {
            const finishedNote = extractGeneratedNote(snapshot);
            if (finishedNote) {
              succeed(finishedNote);
            } else {
              fail(new NoteGenerationError('Note generation finished without content.'));
            }
          } else if (snapshot.summaryStatus === 'failed') {
            fail(new NoteGenerationError('Note generation failed on the server.'));
          }
        } catch {
          // Transient fetch failure: the next poll tick retries.
        } finally {
          checking = false;
        }
      };

      timeoutTimer = setTimeout(() => {
        fail(new NoteGenerationError('Note generation timed out.', true));
      }, timeoutMs);

      // Polling fallback (matches the mobile app: wait 5s, then every 5s).
      pollStartTimeout = setTimeout(() => {
        pollInterval = setInterval(() => {
          check().catch(() => {});
        }, POLL_INTERVAL_MS);
        check().catch(() => {});
      }, POLL_INITIAL_DELAY_MS);

      // ActionCable NotesChannel: streamed note chunks + the finished signal.
      (async () => {
        const token = await authRef.current.getAccessToken();
        if (settled) return;
        installGlobalEventListenerPolyfill();
        const cableUrl = `${authRef.current.apiBaseUrl.replace(/^http/, 'ws')}/cable?token=${encodeURIComponent(token)}`;
        const cableConsumer = createConsumer(cableUrl);
        consumer = cableConsumer;
        subscription = cableConsumer.subscriptions.create(
          { channel: 'NotesChannel', encounter_id: encounterId },
          {
            received(data: unknown) {
              if (settled) return;
              // Broadcasts arrive as JSON strings: either the accumulated
              // partial note (JSON sections or {format:'markdown',content})
              // or the terminal {summary_status:'finished'} signal.
              if (typeof data !== 'string') return;
              setProgressChars(data.length);
              try {
                const parsed = JSON.parse(data) as {
                  summary_status?: string;
                  format?: string;
                  content?: string;
                };
                if (parsed && typeof parsed === 'object') {
                  if (parsed.summary_status === 'finished') {
                    check().catch(() => {});
                  } else if (parsed.format === 'markdown' && typeof parsed.content === 'string') {
                    setProgressChars(parsed.content.length);
                  }
                }
              } catch {
                // Partial JSON mid-stream — progress only.
              }
            },
          }
        );
      })().catch(() => {
        // Cable setup failed (e.g. token fetch): polling still covers us.
      });
    });
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current();
  }, []);

  // Tear down the socket/timers if the host unmounts mid-generation.
  useEffect(() => {
    return () => {
      cancelRef.current();
    };
  }, []);

  return { status, progressChars, serverStatus, note, generate, cancel };
}
