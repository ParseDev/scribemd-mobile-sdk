// Native microphone module API (streaming, file recording, listeners).
export * from './microphone';

// Embedded scribe experience (provider + session UI)
export { ScribeMDProvider, useScribeMDAuth } from './auth/ScribeMDProvider';
export type {
  ScribeMDProviderProps,
  ScribeMDAuthContextValue,
  WebSocketGrant,
  AuthStatus,
} from './auth/ScribeMDProvider';
export { ScribeSession, NoteGenerationFailedError } from './ScribeSession';
export type {
  ScribeSessionProps,
  ScribeSessionResult,
  ScribeSessionHandle,
  PatientContext,
} from './ScribeSession';
export { useWebSocketTranscription } from './hooks/useWebSocketTranscription';
export type {
  UseWebSocketTranscriptionOptions,
  UseWebSocketTranscriptionResult,
  TranscriptionConnectOptions,
  TranscriptSegment,
  TranscriptionConnectionState,
} from './hooks/useWebSocketTranscription';
export { useNoteGeneration, NoteGenerationError } from './hooks/useNoteGeneration';
export type { UseNoteGenerationResult, NoteGenerationStatus } from './hooks/useNoteGeneration';
export {
  createEncounter,
  finalizeEncounter,
  getEncounter,
  extractGeneratedNote,
} from './api/encounters';
export type {
  AuthorizedFetch,
  CreateEncounterOptions,
  EncounterMode,
  EncounterPatientContext,
  EncounterSnapshot,
  FinalizeEncounterOptions,
  GeneratedNote,
} from './api/encounters';
export { fetchUserData } from './api/userData';
export type { ScribeUserConfig, NoteTemplateSummary } from './api/userData';
export { syncEncounter } from './api/sync';
export type { EncounterSyncData, SyncSegment } from './api/sync';
export { recoverPendingSessions } from './recovery';
export { strings, setStrings, applyLanguage, isRtlLanguage } from './strings';
export type { ScribeStrings } from './strings';
export type { ScribeSessionTheme, ScribePalette } from './ui/theme';
export type { FinishControlConfig } from './ui/Controls';

