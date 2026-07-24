/**
 * Offline-first session manifest.
 *
 * Every recording session is journaled to a JSON manifest in the Documents
 * directory (survives process death and OS cache purges, unlike the app's
 * cache-dir WAVs). Segment WAV files live next to it. If the host app is
 * killed mid-visit, the recovery sweep (src/recovery.ts) finds the pending
 * session on the next SDK mount, uploads what's missing and finalizes it
 * server-side so the visit is never lost.
 *
 * All writes are write-through and best-effort: a storage failure must never
 * break a live recording (the in-memory pipeline keeps working; only
 * crash-recovery degrades).
 */
import {
  deleteFile,
  documentsDirectoryUri,
  ensureDirectory,
  isFileSystemAvailable,
  readTextFile,
  writeTextFile,
} from './fileSystem';
import type { EncounterMode } from '../api/encounters';

export interface StoredSegment {
  index: number;
  fileUri: string;
  /** Seconds of audio in this segment. */
  duration: number;
  /** Offsets in seconds from the start of the recording (app parity). */
  startTime: number;
  endTime: number;
  totalDuration: number;
  signedId?: string;
  synced: boolean;
}

export interface StoredSession {
  encounterId: string;
  mode: EncounterMode;
  createdAt: string;
  language?: string;
  noteTemplateId?: string;
  contextNotes?: string;
  segments: StoredSegment[];
  /** Dictation recovery payload: latest synced transcript state. */
  transcript?: string;
  transcriptionData?: string;
  durationSeconds?: number;
  finalized: boolean;
}

interface Manifest {
  version: 1;
  sessions: { [encounterId: string]: StoredSession };
}

const SDK_DIR = 'scribemd-sdk';
const SEGMENTS_DIR = `${SDK_DIR}/segments`;
const MANIFEST_FILE = `${SDK_DIR}/sessions.json`;

function manifestUri(): string {
  return `${documentsDirectoryUri()}/${MANIFEST_FILE}`;
}

/** Directory for segment WAVs; created on demand. */
export function segmentsDirectoryUri(): string {
  const uri = `${documentsDirectoryUri()}/${SEGMENTS_DIR}`;
  ensureDirectory(uri);
  return uri;
}

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await readTextFile(manifestUri());
    if (raw) {
      const parsed = JSON.parse(raw) as Manifest;
      if (parsed && parsed.version === 1 && parsed.sessions) return parsed;
    }
  } catch {
    // Corrupt/unreadable manifest: start fresh rather than crash.
  }
  return { version: 1, sessions: {} };
}

function writeManifest(manifest: Manifest): void {
  ensureDirectory(`${documentsDirectoryUri()}/${SDK_DIR}`);
  writeTextFile(manifestUri(), JSON.stringify(manifest));
}

// All manifest mutations run on one serial chain: rotation, upload
// completions and transcript journaling fire concurrently, and interleaved
// read-modify-write cycles would silently lose updates.
let writeChain: Promise<void> = Promise.resolve();

function update(mutate: (manifest: Manifest) => void): Promise<void> {
  if (!isFileSystemAvailable()) return Promise.resolve();
  writeChain = writeChain.then(async () => {
    try {
      const manifest = await readManifest();
      mutate(manifest);
      writeManifest(manifest);
    } catch {
      // Persistence is best-effort; never break a live session.
    }
  });
  return writeChain;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await update((manifest) => {
    manifest.sessions[session.encounterId] = session;
  });
}

export async function updateSession(
  encounterId: string,
  patch: Partial<StoredSession>
): Promise<void> {
  await update((manifest) => {
    const existing = manifest.sessions[encounterId];
    if (existing) {
      manifest.sessions[encounterId] = { ...existing, ...patch };
    }
  });
}

export async function upsertSegment(encounterId: string, segment: StoredSegment): Promise<void> {
  await update((manifest) => {
    const session = manifest.sessions[encounterId];
    if (!session) return;
    const at = session.segments.findIndex((s) => s.index === segment.index);
    if (at >= 0) session.segments[at] = segment;
    else session.segments.push(segment);
  });
}

export async function markSegmentSynced(
  encounterId: string,
  segmentIndex: number,
  signedId: string
): Promise<void> {
  await update((manifest) => {
    const segment = manifest.sessions[encounterId]?.segments.find(
      (s) => s.index === segmentIndex
    );
    if (segment) {
      segment.signedId = signedId;
      segment.synced = true;
    }
  });
}

/** Unfinalized sessions, oldest first — the recovery sweep's work list. */
export async function listPendingSessions(): Promise<StoredSession[]> {
  if (!isFileSystemAvailable()) return [];
  try {
    const manifest = await readManifest();
    return Object.values(manifest.sessions)
      .filter((session) => !session.finalized)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function markFinalized(encounterId: string): Promise<void> {
  await updateSession(encounterId, { finalized: true });
}

/**
 * Move a session to a new key — used when an encounter created offline
 * (local-... placeholder id) gets its real backend id.
 */
export async function rekeySession(oldEncounterId: string, newEncounterId: string): Promise<void> {
  await update((manifest) => {
    const session = manifest.sessions[oldEncounterId];
    if (session) {
      delete manifest.sessions[oldEncounterId];
      manifest.sessions[newEncounterId] = { ...session, encounterId: newEncounterId };
    }
  });
}

/** True for placeholder ids of encounters created while offline. */
export function isLocalEncounterId(encounterId: string): boolean {
  return encounterId.startsWith('local-');
}

/** Remove the session from the manifest and delete its WAV files. */
export async function purgeSession(encounterId: string): Promise<void> {
  await update((manifest) => {
    const session = manifest.sessions[encounterId];
    if (session) {
      for (const segment of session.segments) {
        deleteFile(segment.fileUri);
      }
      delete manifest.sessions[encounterId];
    }
  });
}
