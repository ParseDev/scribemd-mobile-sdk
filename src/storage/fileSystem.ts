/**
 * Thin wrapper around expo-file-system (the modern File/Directory/Paths API).
 *
 * expo-file-system is a peer dependency, required for visit mode (segment
 * WAV files) and the offline session manifest. It is loaded lazily so
 * dictation-only hosts that never installed it still work — anything that
 * actually touches the filesystem gets a clear installation error instead
 * of a cryptic module-resolution crash.
 */

interface ExpoFile {
  exists: boolean;
  uri: string;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  write(content: string | Uint8Array): void;
  create(options?: { intermediates?: boolean; overwrite?: boolean; idempotent?: boolean }): void;
  delete(): void;
}

interface ExpoDirectory {
  exists: boolean;
  uri: string;
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}

interface ExpoFileSystemModule {
  File: new (...uris: string[]) => ExpoFile;
  Directory: new (...uris: string[]) => ExpoDirectory;
  Paths: { document: { uri: string }; cache: { uri: string } };
}

let cachedModule: ExpoFileSystemModule | null = null;

function fs(): ExpoFileSystemModule {
  if (cachedModule) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-file-system') as ExpoFileSystemModule;
  } catch {
    throw new Error(
      'expo-file-system is required for visit mode and offline recovery. ' +
        'Install it in the host app: npx expo install expo-file-system (or add it to package.json and pod install).'
    );
  }
  return cachedModule;
}

/** True when expo-file-system is installed in the host app. */
export function isFileSystemAvailable(): boolean {
  try {
    fs();
    return true;
  } catch {
    return false;
  }
}

/** Documents directory URI (survives OS cache purges), no trailing slash. */
export function documentsDirectoryUri(): string {
  return fs().Paths.document.uri.replace(/\/$/, '');
}

export function ensureDirectory(uri: string): void {
  const directory = new (fs().Directory)(uri);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
}

export function fileExists(uri: string): boolean {
  return new (fs().File)(uri).exists;
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const file = new (fs().File)(uri);
  if (!file.exists) {
    throw new Error(`File not found: ${uri}`);
  }
  return file.bytes();
}

/** Returns null when the file does not exist. */
export async function readTextFile(uri: string): Promise<string | null> {
  const file = new (fs().File)(uri);
  if (!file.exists) return null;
  return file.text();
}

export function writeTextFile(uri: string, content: string): void {
  const file = new (fs().File)(uri);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(content);
}

/** Best-effort delete; missing files are fine. */
export function deleteFile(uri: string): void {
  try {
    const file = new (fs().File)(uri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup only.
  }
}
