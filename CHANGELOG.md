# Changelog

## 0.4.1 — 2026-07-20

### Added

- **Locales: Arabic, French, Spanish** — full built-in translations (the app's language set: en/he/ar/fr/es), reusing the app's phrasing for shared terms; Arabic gets the existing RTL treatment.
- **Host-owned chrome** — `hideHeader` hides the SDK's title/patient/close (the recording timer stays); pair with a ref and `requestClose()` (`ScribeSessionHandle`) so the host's own close button runs the SDK's confirmation/discard logic.
- **Boot skeleton** — the pre-recording screen renders a shimmering placeholder mirroring the real layout until auth + user config are ready, then appears fully formed in one paint (5s fallback reveals the degraded UI if config never loads).

### Changed

- Rich-editor toolbar: tentap's own Toolbar (focus/selection-safe) docked edge-to-edge on the keyboard, themed via tentap's theme merge (ink icons, accent active states, top radius).
- Close (✕) always confirms; title renamed to "Untitled encounter" (backend draft-name parity).
- Aesthetic pass: breathing idle halo, springing completion badge, italic interim transcript, accent CTA shadow.
- Template picker sheet no longer squeezes search results above the keyboard.

## 0.4.0 — 2026-07-20

Review hardening + the full product-polish arc: app-identity design, in-SDK note review with TipTap, staged generation progress, customizable controls.

### Added

- **In-SDK note review (default on)** — after generation the clinician reviews the note in place: sectioned notes render ordered (numeric-prefix sort) with formatted read mode (bold/bullets) and tap-to-edit per section; markdown-format notes open in a **TipTap rich editor** (`@10play/tentap-editor` — the same engine as the ScribeMD web app; optional peers `@10play/tentap-editor` + `react-native-webview`, plain-editor fallback without them). The toolbar docks edge-to-edge on the keyboard, themed to the SDK. `onComplete` fires on **Approve & send** with the edited note, which is also saved back via `update_notes` (markdown ↔ HTML round-trip via marked/turndown). Opt out with `noteReview={false}`.
- **Staged generation progress** — from the moment the doctor finishes: a checklist (Saving transcript / Uploading audio → Transcribing → Generating note) driven by real server `summary_status`, with a shimmering note skeleton throughout. No interstitial spinners.
- **Customizable finish control** — `finishControl={{ variant: 'slide' | 'button', label?, color?, textColor? }}`.
- **Full theming** — `theme` now accepts `accentColor`, `backgroundColor`, `surfaceColor`, `stopColor`, `textColor`, `secondaryTextColor`; accent-derived tints computed automatically. Defaults follow the ScribeMD app identity (primary `#1E40AF` on slate).
- **App-parity recording screen** — details (template + context) editable during recording with debounced sync, compact timer with red recording dot, single hero per mode (transcript for dictate, tall waveform for visit), ink pause pill + tinted slide-to-finish with trailing fill, template picker with search, context bottom-sheet editor mid-session.
- **Tabler icons** (the app's icon set) bundled as tiny tinted PNGs — zero icon dependencies.
- Web-widget parity props: `noteTemplateId` + `noteTemplateLocked`, `initialContext`, `autoStart`, `initialMode`.
- Close (✕) always confirms — destructive discard warning while recording, light close confirm otherwise. Title is "Untitled encounter" (backend draft-name parity).

### Review pass (3 independent reviews: session lifecycle, API contract, native/security — 20+ fixes)

### Fixed — critical/high

- **Android: pause → resume permanently killed the audio pipeline** (the reader coroutine exited on pause and never restarted; every post-resume segment was empty).
- **Token refresh used the wrong endpoint** — refresh now uses `POST /users/tokens/refresh`, so sessions no longer break when the access token expires.
- **Cancel/unmount during session start could resurrect the session and leave the mic hot** — handleStart now runs under a generation counter and unwinds when stale.
- **Partial visit uploads are no longer finalized** — if any segment failed to upload, the session stays journaled for recovery instead of generating a note with audio holes (and its local audio is no longer purged).
- **Mic/native error during a visit no longer leaves the 20s rotation running forever** in the error state.
- **Segment rotation vs stop/pause races** — all capture operations now run on one serial chain; the final segment can't be dropped and native file recording can't leak into the next session.
- **Android: visit stop ordering** — the final segment is closed before the streaming service is torn down (was orphaning the last ≤20s WAV).
- **Android: RECORD_AUDIO is now actually requested** (Android never auto-prompts; first-run sessions previously failed opaquely).
- **Android: crash-orphaned WAV headers are repaired at upload** (zero-size RIFF/data headers made recovered segments decode as 0 samples); service is `START_NOT_STICKY` (no zombie restarts) and the stop-path handshake discards stale paths (`@Volatile`, pre-stop clear).
- **iOS: audio-session interruptions (phone call/Siri) are now observed** — capture resumes when the system allows it, or surfaces an error instead of silently recording nothing.

### Fixed — correctness/docs

- Final dictation `transcription_data` (speaker/timing map) is pushed via `/sync` before finalize (the update action silently drops it); crash recovery does the same.
- `prompt[device]="null"` is now sent explicitly on create.
- Visit finalize duration now comes from the segment ledger, not the suspendable UI timer.
- Live-sync change detection compares transcript content, not length (same-length STT corrections were skipped).
- Orphaned WAVs from aborted/sliver segments are deleted.
- INTEGRATION.md: documents `noteTemplateLocked`/`initialContext`/`autoStart`, iOS `UIBackgroundModes: audio`, the real Android permission behavior, mode-aware generation budgets, and pins `#v0.3.0`.
- Packaging: `example-bare/` excluded from the published package; `expo-modules-core` declared as a peer.

## 0.3.0 — 2026-07-13

App-parity release: both recording modes, templates, context, offline-first.

### Added

- **Visit mode** — full port of the app's segment pipeline: rolling 20-second WAV segment files (native recorder), Rails ActiveStorage direct upload to S3 (MD5 checksummed), per-segment attach via `POST /encounters/:id/sync`, finalize with `platform_source=upload_mobile` which triggers server-side batch transcription then note generation. Sequential, ordered, idempotent upload queue with retry; failures surface as a dismissable banner while recording continues.
- **Mode selection** — the session defaults to the user's server-side `active_encounter_mode`; a pre-recording visit/dictation toggle is shown when the user's `encounter_modes` setting allows it. Hosts can force a mode with `initialMode`.
- **Note templates** — the user's template list (from `GET /api/v1/users/user_data`) with their default preselected, shown in a bottom-sheet picker on the pre-recording screen. Hosts can pass `noteTemplateId` to preselect; the backend falls back user → organization default when unset.
- **Context input** — free-text "Add context" field stored as `current_notes_text` (app parity).
- **Offline-first crash recovery** — every session is journaled to a manifest in the Documents directory (segments, template, context, latest dictation transcript). If the host app dies mid-recording, the provider's recovery sweep finalizes the session on the next mount (uploading remaining segments, creating the encounter if the session started offline) and reports it via the new `onSessionRecovered` provider prop. Explicit Cancel purges the journal.
- **Dictation live sync** — transcript state syncs to the server every 5 s during recording (app parity), so dictation drafts are recoverable server-side too.
- **`userConfig` on the provider context** — parsed user_data subset (`activeEncounterMode`, `encounterModesEnabled`, `noteTemplates`, `defaultNoteTemplateId`) + `refreshUserConfig()`.
- New strings (en/he): mode labels, template picker, context field, visit-phase hints, segment-upload errors.

### Changed

- `finalizeEncounter` now sends multipart FormData for both modes (app parity) and carries `transcription_data`; visit adds `segment_keys[]`.
- Note-generation budget is mode-aware: 6 minutes for visit (batch transcription runs first), 3 minutes for dictation.
- Visit-mode `onComplete.transcript` is fetched from the finished encounter (`custom_conversation`, produced server-side).

### Dependencies

- New dependency: `crypto-js` (S3 Content-MD5).
- New peer dependency: `expo-file-system` — **required for visit mode and offline recovery** (dictation-only hosts can omit it; a clear runtime error is raised if visit mode is used without it). Install in the host: `npx expo install expo-file-system` + pod install.

## 0.2.0 — 2026-07-11

First integrator-ready release.

### Added

- **`<ScribeMDProvider>`** — Session auth: exchanges a one-time session token (`POST /ehrs/mobile/session_token`) for access/refresh tokens, held in memory only, with proactive refresh and single 401 retry. Dev path via `apiToken`. Configurable `apiBaseUrl`, `wsBaseUrl`, `language`.
- **`<ScribeSession>`** — self-contained session UI: record button, live waveform, timer, live transcript (interim + final segments), pause/resume, status pill, cancel, error/retry states.
- **Note generation pipeline** — draft encounter created before the socket connects (STT stream attributed via `encounter_id`), transcript finalized on Stop (`PUT /api/v1/encounters/:id`), generated note delivered over ActionCable NotesChannel with polling fallback and a 3-minute budget. `onComplete` carries `{ transcript, encounterId?, note? }` with `note.markdown` / `note.json` / `note.plain`.
- **Data-safety error contract** — `NoteGenerationFailedError` carries the transcript and `encounterId`; `onComplete` still fires with the transcript after generation failures. Mid-recording connection loss shows a dismissable banner and keeps the session (and captured transcript) alive.
- **Native audio module** (Expo Modules, iOS + Android) — 16 kHz mono PCM streaming, audio levels, pause/resume, Android foreground service (`microphone` type), audio route change events, M4A file recording, keep-alive mode, iOS App Intent hook.
- **Theming** — `theme={{ accentColor, backgroundColor }}` on `ScribeSession`, resolved palette threaded via ThemeContext.
- **i18n / RTL** — built-in English and Hebrew locales auto-applied from the provider `language`; `setStrings()` host overrides always win; RTL transcript alignment (`he`, `ar`, `fa`, `ur`, `yi`).
- **Safe-area handling** — uses `react-native-safe-area-context` when present, graceful fallback otherwise (optional peer dependency).
- **Lower-level exports** — `useWebSocketTranscription`, `useNoteGeneration`, encounters REST client (`createEncounter`, `finalizeEncounter`, `getEncounter`, `extractGeneratedNote`), raw microphone API.
- **Example app** — `example-bare/` (React Native 0.85, new architecture) verified on iOS and Android, including the Metro `blockList` config for symlinked consumption.

## 0.1.0

Internal scaffold: `create-expo-module` base + native microphone-stream module port.
