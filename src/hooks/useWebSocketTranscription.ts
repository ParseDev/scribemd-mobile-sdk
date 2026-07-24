import { useCallback, useEffect, useRef, useState } from 'react';

import { useScribeMDAuth } from '../auth/ScribeMDProvider';

// Reconnection config (ported from the ScribeMD mobile app).
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000]; // exponential backoff, capped at 10s
const RECONNECT_JITTER_MS = 500;
const MAX_RECONNECT_ATTEMPTS = 10;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_BUFFER_SIZE = 1200; // ~60 seconds of audio at 20 chunks/sec

export type TranscriptionConnectionState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface TranscriptSegment {
  id: string;
  text: string;
  speaker?: string;
  receivedAt: number;
}

export interface UseWebSocketTranscriptionOptions {
  /**
   * Optional encounter to attribute the stream to. Not required for a plain
   * transcription session; supplied once note generation creates encounters.
   */
  encounterId?: string;
  /** Transcription backend routed by the STT gateway. Default: 'soniox'. */
  service?: string;
  /** Backend environment flag forwarded to the gateway. Default: 'production'. */
  env?: string;
  /** Free-text clinical context sent as the first WebSocket message. */
  sttContext?: string;
  /** Custom keyword hints sent as the first WebSocket message. */
  terms?: string[];
  /** Called on unrecoverable failures (auth rejection, reconnect exhaustion). */
  onError?: (error: Error) => void;
}

export interface TranscriptionConnectOptions {
  /**
   * Encounter to attribute the stream to, decided at connect time (the
   * encounter is created right before connecting). Takes precedence over
   * the hook-level `encounterId` option and persists across reconnects.
   */
  encounterId?: string;
}

export interface UseWebSocketTranscriptionResult {
  connectionState: TranscriptionConnectionState;
  /** Finalized transcript segments, oldest first. */
  segments: TranscriptSegment[];
  /** Current interim (non-final) hypothesis, cleared when a final arrives. */
  interimText: string;
  /** Open the WebSocket. Resolves once connected; auto-reconnects afterwards. */
  connect: (connectOptions?: TranscriptionConnectOptions) => Promise<void>;
  /** Close the WebSocket and stop any reconnection attempts. */
  disconnect: () => void;
  /** Send a PCM16 chunk. Buffers (up to ~60s) while disconnected. */
  sendAudioChunk: (data: ArrayBuffer) => boolean;
  /** While finishing, socket closes are final — no reconnection is scheduled. */
  setFinishing: (finishing: boolean) => void;
  /** Clear segments, interim text and the audio buffer. */
  reset: () => void;
  /** Accumulated final transcript (plus trailing interim text by default). */
  getFinalTranscript: (includeInterim?: boolean) => string;
  getBufferStats: () => { count: number; maxSize: number; isBuffering: boolean };
}

interface BufferedChunk {
  data: ArrayBuffer;
  timestamp: number;
}

interface ServerMessage {
  transcription?: string;
  is_final?: boolean;
  speaker?: string;
  error?: string;
  channel?: { alternatives?: { transcript?: string }[] };
}

export function useWebSocketTranscription(
  options: UseWebSocketTranscriptionOptions = {}
): UseWebSocketTranscriptionResult {
  const auth = useScribeMDAuth();

  const [connectionState, setConnectionState] = useState<TranscriptionConnectionState>('idle');
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');

  // Latest values readable from stable callbacks.
  const authRef = useRef(auth);
  authRef.current = auth;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const interimRef = useRef('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<BufferedChunk[]>([]);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFinishingRef = useRef(false);
  const isConnectedRef = useRef(false);
  const isDrainingRef = useRef(false);
  const shouldBeConnectedRef = useRef(false);
  const forceFreshGrantRef = useRef(false);
  const connectOptionsRef = useRef<TranscriptionConnectOptions>({});

  const updateSegments = useCallback((next: TranscriptSegment[]) => {
    segmentsRef.current = next;
    setSegments(next);
  }, []);

  const updateInterim = useCallback((text: string) => {
    interimRef.current = text;
    setInterimText(text);
  }, []);

  const emitError = useCallback((error: Error) => {
    optionsRef.current.onError?.(error);
  }, []);

  const processServerMessage = useCallback(
    (data: ServerMessage) => {
      // Gateway format: { transcription, is_final, speaker, ... }
      // Deepgram passthrough: { channel: { alternatives: [{ transcript }] }, is_final }
      let text: string | undefined;
      let isFinal = false;
      if (data.transcription) {
        text = data.transcription;
        isFinal = data.is_final ?? false;
      } else if (data.channel?.alternatives?.[0]?.transcript) {
        text = data.channel.alternatives[0].transcript;
        isFinal = data.is_final ?? false;
      }
      if (!text) return;

      if (!isFinal) {
        updateInterim(text);
        return;
      }

      const segment: TranscriptSegment = {
        id: `${Date.now()}-${Math.random()}`,
        text,
        speaker: data.speaker,
        receivedAt: Date.now(),
      };

      // If this final overlaps the previous one (same utterance, extended
      // text), replace it instead of appending a duplicate.
      const current = segmentsRef.current;
      const last = current[current.length - 1];
      if (last && (text.startsWith(last.text.trim()) || last.text.trim().startsWith(text))) {
        updateSegments([...current.slice(0, -1), segment]);
      } else {
        updateSegments([...current, segment]);
      }
      updateInterim('');
    },
    [updateInterim, updateSegments]
  );

  const cancelReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const drainBuffer = useCallback(() => {
    if (isDrainingRef.current) return;
    const buffer = audioBufferRef.current;
    if (buffer.length === 0) return;
    if (!isConnectedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

    isDrainingRef.current = true;
    try {
      for (const chunk of buffer) {
        if (!isConnectedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) break;
        wsRef.current.send(chunk.data);
      }
      audioBufferRef.current = [];
    } catch {
      // Remaining chunks stay buffered; the next successful open drains again.
    } finally {
      isDrainingRef.current = false;
    }
  }, []);

  const sendAudioChunk = useCallback((data: ArrayBuffer): boolean => {
    if (isConnectedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(data);
        return true;
      } catch {
        isConnectedRef.current = false; // fall through to buffering
      }
    }
    const buffer = audioBufferRef.current;
    if (buffer.length >= MAX_BUFFER_SIZE) {
      buffer.shift(); // drop the oldest chunk
    }
    buffer.push({ data, timestamp: Date.now() });
    return false;
  }, []);

  const teardownSocket = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      wsRef.current = null;
    }
    isConnectedRef.current = false;
  }, []);

  // Declared as a ref so the reconnect timer can re-enter it without
  // creating a dependency cycle between useCallback closures.
  const openSocketRef = useRef<(isReconnect: boolean) => Promise<void>>(async () => {});

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionState('error');
      emitError(new Error('Transcription connection lost: max reconnect attempts reached.'));
      return;
    }
    const delay =
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] +
      Math.random() * RECONNECT_JITTER_MS;
    setConnectionState('reconnecting');
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptRef.current += 1;
      if (shouldBeConnectedRef.current) {
        openSocketRef.current(true).catch(() => {
          // Failures inside openSocket schedule their own retry.
        });
      }
    }, delay);
  }, [emitError]);

  openSocketRef.current = async (isReconnect: boolean): Promise<void> => {
    cancelReconnect();
    teardownSocket();
    setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

    let grant;
    try {
      grant = await authRef.current.getWebsocketToken(forceFreshGrantRef.current);
      forceFreshGrantRef.current = false;
    } catch (error) {
      if (isReconnect && shouldBeConnectedRef.current) {
        scheduleReconnect();
        return;
      }
      setConnectionState('error');
      throw error instanceof Error ? error : new Error('Failed to fetch WebSocket token');
    }

    const {
      encounterId: hookEncounterId,
      service = 'soniox',
      env = 'production',
    } = optionsRef.current;
    const encounterId = connectOptionsRef.current.encounterId ?? hookEncounterId;
    const params = [
      `access_token=${encodeURIComponent(grant.access_token)}`,
      `language=${encodeURIComponent(authRef.current.language)}`,
      `service=${encodeURIComponent(service)}`,
      `env=${encodeURIComponent(env)}`,
    ];
    if (encounterId) {
      params.push(`encounter_id=${encodeURIComponent(encounterId)}`);
    }
    const url = `${authRef.current.wsBaseUrl}/v1/listen?${params.join('&')}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (error) reject(error);
        else resolve();
      };
      const connectTimer = setTimeout(() => {
        settle(new Error('Timed out connecting to the transcription service.'));
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectedRef.current = true;
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');

        // Context payload must be the FIRST message, before any audio.
        const { sttContext, terms } = optionsRef.current;
        if (sttContext || (terms && terms.length > 0)) {
          try {
            ws.send(JSON.stringify({ stt_context: sttContext ?? '', terms: terms ?? [] }));
          } catch {
            // Non-fatal: transcription works without context hints.
          }
        }

        drainBuffer();
        settle();
      };

      ws.onmessage = (event) => {
        let data: ServerMessage;
        try {
          data = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return; // Ignore malformed frames.
        }
        if (data.error) {
          isConnectedRef.current = false;
          if (data.error.includes('Authentication failed')) {
            forceFreshGrantRef.current = true;
            shouldBeConnectedRef.current = false;
            setConnectionState('error');
            teardownSocket();
            emitError(new Error(`Transcription authentication failed: ${data.error}`));
            settle(new Error(data.error));
            return;
          }
          // Other server errors (timeouts, etc.): close and let onclose reconnect.
          try {
            ws.close();
          } catch {
            // Ignore.
          }
          return;
        }
        processServerMessage(data);
      };

      ws.onerror = () => {
        isConnectedRef.current = false;
        // Force close so onclose fires and reconnection is scheduled, even
        // when the transport errors without closing cleanly.
        try {
          if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
            ws.close();
          }
        } catch {
          // Ignore.
        }
      };

      ws.onclose = (event) => {
        isConnectedRef.current = false;
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        if (event.code === 1008) {
          // Policy violation: our grant was rejected. Fetch a fresh one next time.
          forceFreshGrantRef.current = true;
          setConnectionState('error');
          emitError(new Error('Transcription WebSocket rejected authentication (1008).'));
          settle(new Error('WebSocket authentication rejected (1008).'));
          return;
        }

        if (isFinishingRef.current || !shouldBeConnectedRef.current || event.code === 1000) {
          setConnectionState('disconnected');
          settle(new Error(`WebSocket closed before connecting (code ${event.code}).`));
          return;
        }

        settle(new Error(`WebSocket closed before connecting (code ${event.code}).`));
        scheduleReconnect();
      };
    });
  };

  const connect = useCallback(
    async (connectOptions: TranscriptionConnectOptions = {}): Promise<void> => {
      connectOptionsRef.current = connectOptions;
      shouldBeConnectedRef.current = true;
      isFinishingRef.current = false;
      reconnectAttemptRef.current = 0;
      await openSocketRef.current(false);
    },
    []
  );

  const disconnect = useCallback(() => {
    shouldBeConnectedRef.current = false;
    cancelReconnect();
    teardownSocket();
    setConnectionState('idle');
  }, [cancelReconnect, teardownSocket]);

  const setFinishing = useCallback(
    (finishing: boolean) => {
      isFinishingRef.current = finishing;
      if (finishing) {
        cancelReconnect();
      }
    },
    [cancelReconnect]
  );

  const reset = useCallback(() => {
    updateSegments([]);
    updateInterim('');
    audioBufferRef.current = [];
  }, [updateSegments, updateInterim]);

  const getFinalTranscript = useCallback((includeInterim = true): string => {
    const parts = segmentsRef.current.map((segment) => segment.text.trim());
    const interim = interimRef.current.trim();
    if (includeInterim && interim.length > 0) {
      parts.push(interim);
    }
    return parts.filter((part) => part.length > 0).join('\n');
  }, []);

  const getBufferStats = useCallback(
    () => ({
      count: audioBufferRef.current.length,
      maxSize: MAX_BUFFER_SIZE,
      isBuffering: audioBufferRef.current.length > 0,
    }),
    []
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      shouldBeConnectedRef.current = false;
      cancelReconnect();
      teardownSocket();
    };
  }, [cancelReconnect, teardownSocket]);

  return {
    connectionState,
    segments,
    interimText,
    connect,
    disconnect,
    sendAudioChunk,
    setFinishing,
    reset,
    getFinalTranscript,
    getBufferStats,
  };
}
