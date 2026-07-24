import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { fetchUserData, type ScribeUserConfig } from '../api/userData';
import { recoverPendingSessions } from '../recovery';

const DEFAULT_API_BASE_URL = 'https://www.scribemd.ai';
const DEFAULT_WS_BASE_URL = 'wss://stt.scribemd.ai';
const DEFAULT_LANGUAGE = 'en';

/** Refresh/refetch tokens this many ms before their known expiry. */
const TOKEN_EXPIRY_SLACK_MS = 30_000;

export type AuthStatus = 'initializing' | 'ready' | 'error';

/** Short-lived token used to authenticate the transcription WebSocket. */
export interface WebSocketGrant {
  access_token: string;
  /** ISO-8601 expiry timestamp. */
  expires_at: string;
  key_type?: string;
}

export interface ScribeMDAuthContextValue {
  apiBaseUrl: string;
  wsBaseUrl: string;
  language: string;
  status: AuthStatus;
  /** Human-readable auth failure when status === 'error'. */
  error: string | null;
  /**
   * fetch() against `${apiBaseUrl}${path}` with a Bearer access token.
   * Waits for the initial token exchange, proactively refreshes an expired
   * access token, and retries once after a refresh when the server replies 401.
   */
  authorizedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * Current API access token (refreshed when close to expiry). Used for
   * transports that can't send an Authorization header, e.g. the ActionCable
   * connection (`/cable?token=...`) that streams generated notes.
   */
  getAccessToken: () => Promise<string>;
  /**
   * Grant for the transcription WebSocket (POST /api/v1/auth/grant,
   * type: websocket). Cached in memory until shortly before expiry.
   */
  getWebsocketToken: (forceRefresh?: boolean) => Promise<WebSocketGrant>;
  /**
   * Session-relevant user configuration (default encounter mode, note
   * templates, ...). Fetched once after auth is ready; null until it loads
   * or when the fetch failed — sessions must degrade gracefully (dictation
   * only, no mode toggle, no template list).
   */
  userConfig: ScribeUserConfig | null;
  /** Re-fetch user configuration (e.g. after templates changed server-side). */
  refreshUserConfig: () => Promise<void>;
}

export interface ScribeMDProviderProps {
  /** ScribeMD API origin. Default: https://www.scribemd.ai */
  apiBaseUrl?: string;
  /** Transcription WebSocket origin. Default: wss://stt.scribemd.ai */
  wsBaseUrl?: string;
  /** Transcription language code. Default: 'en' */
  language?: string;
  /**
   * One-time session token minted by your backend. Exchanged once on mount:
   *   POST {apiBaseUrl}/ehrs/mobile/session_token  { session_token }
   *   -> { access_token, refresh_token, expires_in }
   * Provide EXACTLY ONE of sessionToken / apiToken.
   */
  sessionToken?: string;
  /**
   * Pre-existing devise JWT (dev/testing path). Used as-is; no refresh
   * is possible on this path. Provide EXACTLY ONE of sessionToken / apiToken.
   */
  apiToken?: string;
  /**
   * Called when the crash-recovery sweep finalized a session from a previous
   * process (the host app died mid-recording). The note is generated
   * server-side; the id can be used to fetch it.
   */
  onSessionRecovered?: (encounterId: string) => void;
  children: React.ReactNode;
}

interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Token refresh response: the new access token is returned under `token`. */
interface RefreshResponse {
  token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Mark rejections as handled so an early auth failure never surfaces
  // as an unhandled promise rejection when nothing is awaiting yet.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const ScribeMDAuthContext = createContext<ScribeMDAuthContextValue | null>(null);

export function ScribeMDProvider({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  wsBaseUrl = DEFAULT_WS_BASE_URL,
  language = DEFAULT_LANGUAGE,
  sessionToken,
  apiToken,
  onSessionRecovered,
  children,
}: ScribeMDProviderProps): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [userConfig, setUserConfig] = useState<ScribeUserConfig | null>(null);

  // All tokens live in memory only — nothing is persisted to disk.
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const accessExpiresAtRef = useRef<number | null>(null); // ms epoch
  const refreshInFlightRef = useRef<Promise<string> | null>(null);
  const wsGrantRef = useRef<WebSocketGrant | null>(null);
  const wsGrantInFlightRef = useRef<Promise<WebSocketGrant> | null>(null);
  const readyRef = useRef<Deferred | null>(null);
  if (readyRef.current === null) {
    readyRef.current = createDeferred();
  }

  const fail = useCallback((message: string) => {
    setStatus('error');
    setError(message);
    readyRef.current?.reject(new Error(message));
  }, []);

  // One-time bootstrap: validate props and establish the access token.
  useEffect(() => {
    const providedInputs = [sessionToken, apiToken].filter(Boolean).length;
    if (providedInputs !== 1) {
      fail('ScribeMDProvider requires exactly one of sessionToken or apiToken.');
      return;
    }

    if (apiToken) {
      accessTokenRef.current = apiToken;
      setStatus('ready');
      readyRef.current?.resolve();
      return;
    }

    let cancelled = false;
    (async () => {
      const response = await fetch(`${apiBaseUrl}/ehrs/mobile/session_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken }),
      });
      if (!response.ok) {
        throw new Error(`Session token exchange failed (${response.status})`);
      }
      const data = (await response.json()) as TokenExchangeResponse;
      if (cancelled) return;
      accessTokenRef.current = data.access_token;
      refreshTokenRef.current = data.refresh_token;
      accessExpiresAtRef.current =
        typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : null;
      setStatus('ready');
      readyRef.current?.resolve();
    })().catch((err: unknown) => {
      if (cancelled) return;
      fail(err instanceof Error ? err.message : 'Session token exchange failed');
    });

    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: the session token is single-use.
  }, []);

  /** Refresh the access token, deduplicating concurrent attempts. */
  const refreshAccessToken = useCallback(async (): Promise<string> => {
    const refreshToken = refreshTokenRef.current;
    if (!refreshToken) {
      throw new Error('Access token rejected and no refresh token is available.');
    }
    if (!refreshInFlightRef.current) {
      refreshInFlightRef.current = (async () => {
        // Exchange the refresh token for a new access token. The refresh
        // token is sent as the Bearer credential on this request.
        const response = await fetch(`${apiBaseUrl}/users/tokens/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshToken}`,
          },
        });
        if (!response.ok) {
          throw new Error(`Token refresh failed (${response.status})`);
        }
        const data = (await response.json()) as RefreshResponse;
        if (!data.token) {
          throw new Error('Token refresh returned no token.');
        }
        accessTokenRef.current = data.token;
        if (data.refresh_token) {
          refreshTokenRef.current = data.refresh_token;
        }
        accessExpiresAtRef.current =
          typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : null;
        return data.token;
      })().finally(() => {
        refreshInFlightRef.current = null;
      });
    }
    return refreshInFlightRef.current;
  }, [apiBaseUrl]);

  /** Current access token, proactively refreshed when close to expiry. */
  const ensureAccessToken = useCallback(async (): Promise<string> => {
    await readyRef.current!.promise;
    const expiresAt = accessExpiresAtRef.current;
    if (
      expiresAt !== null &&
      Date.now() > expiresAt - TOKEN_EXPIRY_SLACK_MS &&
      refreshTokenRef.current
    ) {
      return refreshAccessToken();
    }
    const token = accessTokenRef.current;
    if (!token) {
      throw new Error('No access token available.');
    }
    return token;
  }, [refreshAccessToken]);

  const authorizedFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const url = `${apiBaseUrl}${path}`;
      const request = (token: string) =>
        fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });

      let response = await request(await ensureAccessToken());
      if (response.status === 401 && refreshTokenRef.current) {
        const freshToken = await refreshAccessToken();
        response = await request(freshToken);
      }
      return response;
    },
    [apiBaseUrl, ensureAccessToken, refreshAccessToken]
  );

  const getWebsocketToken = useCallback(
    async (forceRefresh = false): Promise<WebSocketGrant> => {
      const cached = wsGrantRef.current;
      if (
        !forceRefresh &&
        cached &&
        new Date(cached.expires_at).getTime() - Date.now() > TOKEN_EXPIRY_SLACK_MS
      ) {
        return cached;
      }
      if (forceRefresh) {
        wsGrantRef.current = null;
      }
      if (!wsGrantInFlightRef.current) {
        wsGrantInFlightRef.current = (async () => {
          const response = await authorizedFetch('/api/v1/auth/grant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'websocket' }),
          });
          if (!response.ok) {
            throw new Error(`WebSocket token grant failed (${response.status})`);
          }
          const grant = (await response.json()) as WebSocketGrant;
          wsGrantRef.current = grant;
          return grant;
        })().finally(() => {
          wsGrantInFlightRef.current = null;
        });
      }
      return wsGrantInFlightRef.current;
    },
    [authorizedFetch]
  );

  const refreshUserConfig = useCallback(async (): Promise<void> => {
    setUserConfig(await fetchUserData(authorizedFetch));
  }, [authorizedFetch]);

  // Load user configuration once auth is ready. Failure is non-fatal: the
  // session degrades to dictation-only with no mode toggle or template list.
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    fetchUserData(authorizedFetch)
      .then((config) => {
        if (!cancelled) setUserConfig(config);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, authorizedFetch]);

  // Crash recovery: finalize sessions a previous process left unfinished.
  // Bounded to sessions created before this mount so a recording that just
  // started in THIS process is never swept mid-session.
  const mountedAtRef = useRef(new Date().toISOString());
  const onSessionRecoveredRef = useRef(onSessionRecovered);
  onSessionRecoveredRef.current = onSessionRecovered;
  const recoveryRanRef = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || recoveryRanRef.current) return;
    recoveryRanRef.current = true;
    recoverPendingSessions(
      authorizedFetch,
      (encounterId) => onSessionRecoveredRef.current?.(encounterId),
      mountedAtRef.current
    ).catch(() => {});
  }, [status, authorizedFetch]);

  const value = useMemo<ScribeMDAuthContextValue>(
    () => ({
      apiBaseUrl,
      wsBaseUrl,
      language,
      status,
      error,
      authorizedFetch,
      getAccessToken: ensureAccessToken,
      getWebsocketToken,
      userConfig,
      refreshUserConfig,
    }),
    [
      apiBaseUrl,
      wsBaseUrl,
      language,
      status,
      error,
      authorizedFetch,
      ensureAccessToken,
      getWebsocketToken,
      userConfig,
      refreshUserConfig,
    ]
  );

  return <ScribeMDAuthContext.Provider value={value}>{children}</ScribeMDAuthContext.Provider>;
}

/** Access the ScribeMD auth context. Must be used inside <ScribeMDProvider>. */
export function useScribeMDAuth(): ScribeMDAuthContextValue {
  const context = useContext(ScribeMDAuthContext);
  if (!context) {
    throw new Error('useScribeMDAuth must be used within a <ScribeMDProvider>.');
  }
  return context;
}
