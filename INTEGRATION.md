# ScribeMD React Native SDK — Integration Guide

`@scribemd-ai/mobile-sdk` embeds a complete ScribeMD medical-scribe session in your React Native app: live microphone capture, real-time transcription, and clinical note generation, wrapped in a ready-made session UI.

The integration surface is intentionally small — two components:

```tsx
<ScribeMDProvider sessionToken={token}>
  <ScribeSession onComplete={({ transcript, note }) => { /* ... */ }} />
</ScribeMDProvider>
```

---

## 1. Prerequisites

- **React Native >= 0.80** (verified against 0.85.x, React 19.2, new architecture enabled). Both bare React Native and Expo apps are supported.
- **Expo Modules API.** The SDK's native audio module is an Expo Module. Expo apps have this already. **Bare RN apps** must install it once:

  ```sh
  npx install-expo-modules@latest
  ```

  This adds the `expo` package and wires `ExpoModulesCore` into your iOS/Android projects (autolinking included).
- **iOS**: physical device or simulator, min iOS as per your RN version. CocoaPods.
- **Android**: minSdk per your RN version; the SDK uses a foreground service with `microphone` type (Android 14+ requirement handled).
- Optional peer: `react-native-safe-area-context`. If it is installed the session UI uses it for notch/home-indicator insets; if not, a built-in fallback is used. Not required.
- Peer: `expo-file-system` — **required for visit mode (audio segment upload) and offline crash recovery**. Dictation-only hosts can omit it (a clear runtime error is raised if visit mode is used without it):

  ```sh
  npx expo install expo-file-system   # then: cd ios && pod install
  ```
- Optional peers: `@10play/tentap-editor` + `react-native-webview` — enable the **TipTap rich editor** (same engine as the ScribeMD web app) for markdown-format notes in the in-SDK review screen. Without them the review falls back to a plain text editor — nothing breaks:

  ```sh
  npm install @10play/tentap-editor react-native-webview   # then: cd ios && pod install
  ```

---

## 2. Installation

Install with any package manager:

```sh
npm install @scribemd-ai/mobile-sdk          # latest
npm install @scribemd-ai/mobile-sdk@0.4.4     # pinned
```

Notes:

- The published package ships prebuilt (`build/`) plus the native iOS/Android sources — no compile-on-install.
- After installing on iOS: `cd ios && pod install`.

You can also install straight from the repository:

```sh
npm install "github:ParseDev/scribemd-mobile-sdk#v0.4.4"
```

---

## 3. iOS setup

Add the microphone usage description to your app's `Info.plist` (recording will crash without it):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>ScribeMD records the visit conversation to generate a medical transcript and clinical note.</string>
```

**Required for recording to survive backgrounding** (switching apps mid-visit): enable the audio background mode, also in `Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

That's it — the native module autolinks via Expo Modules. Run `pod install` after adding the dependency.

---

## 4. Android setup

The SDK's own manifest declares the permissions and the foreground service, and Android's manifest merger folds them into your app automatically. We still recommend declaring the permissions explicitly in your app's `android/app/src/main/AndroidManifest.xml` so the requirement is visible and survives tooling changes:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />

    <!-- ... your application element ... -->
</manifest>
```

What the SDK's merged manifest contributes (for reference — you do not add this yourself):

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<application>
  <service
    android:name="ai.scribemd.scribe.MicrophoneStreamService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="microphone" />
</application>
```

The runtime `RECORD_AUDIO` permission prompt is requested by the SDK (via `PermissionsAndroid`) the first time a session starts — no extra permission code needed in the host app. If the user denies it, the session fails with a clear "Microphone permission was not granted" error.

---

## 5. Metro gotcha (monorepo / symlinked installs only)

If you consume the SDK **via a symlink or monorepo workspace** (e.g. `"link:../scribemd-mobile-sdk"` during development), Metro will see the SDK's own `node_modules/react` and `node_modules/react-native` and may bundle those copies instead of your app's — which crashes at startup with an RN version mismatch. Block them in your `metro.config.js`:

```js
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const sdkRoot = path.resolve(__dirname, '../scribemd-mobile-sdk'); // wherever the SDK lives
const escapedSdkRoot = sdkRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = {
  watchFolders: [sdkRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(sdkRoot, 'node_modules'),
    ],
    // The SDK root carries its own react/react-native (dev deps) —
    // bundling those into your app's binary crashes at startup.
    // Always resolve the app's copies. Same for @react-native/assets-registry:
    // a second registry instance makes the SDK's bundled icons register in
    // one copy while Image reads the other (wrong/missing icons).
    blockList: [
      new RegExp(`${escapedSdkRoot}/node_modules/react-native/.*`),
      new RegExp(`${escapedSdkRoot}/node_modules/react/.*`),
      new RegExp(`${escapedSdkRoot}/node_modules/@react-native/assets-registry/.*`),
    ],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
      '@react-native/assets-registry': path.resolve(
        __dirname,
        'node_modules/@react-native/assets-registry'
      ),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
```

A normal git/npm install into `node_modules` does **not** need this.

---

## 6. Authentication flow

Two credentials exist; the app only ever sees the short-lived one.

### 6.1 Server side (your backend, never the app)

Your backend holds a ScribeMD **API key**. To start a session for a clinician, exchange their identity for a one-time session token:

```
POST https://www.scribemd.ai/ehrs/mobile/validate_user
Authorization: Bearer <YOUR_SCRIBEMD_API_KEY>
Content-Type: application/json

{ "username": "<clinician EHR username or email>" }
```

Response:

```json
{
  "success": true,
  "session_token": "abc123..."
}
```

- `session_token` is **single-use** and expires after **1 hour** if unused.
- The API key must never ship inside the mobile app. Hand only the `session_token` to the app.
- `username` can be the clinician's EHR username or their ScribeMD account email; `email` is accepted as an alias parameter.
- `401` with `{ "success": false, "error": "..." }` when the API key is invalid or the user is not found/inactive. This endpoint is rate limited — cache nothing, but don't call it in a loop.

### 6.2 App side

Pass the session token to the provider:

```tsx
<ScribeMDProvider sessionToken={sessionToken}>...</ScribeMDProvider>
```

On mount the provider exchanges it once (`POST /ehrs/mobile/session_token`) for access/refresh tokens. All tokens are held **in memory only** — nothing is persisted to disk. The provider transparently refreshes the access token before expiry and retries once on `401`.

For **development only**, you can bypass the session-token exchange with a pre-existing ScribeMD API JWT:

```tsx
<ScribeMDProvider apiToken={devJwt}>...</ScribeMDProvider>
```

Provide **exactly one** of `sessionToken` / `apiToken` — the provider errors otherwise. Because the session token is single-use, mount a fresh provider (with a fresh token) per sign-in, not per screen.

---

## 7. API reference

### `<ScribeMDProvider>`

Supplies authentication and configuration to everything below it.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `sessionToken` | `string` | — | One-time session token from `validate_user`. Exchanged once on mount. Provide exactly one of `sessionToken`/`apiToken`. |
| `apiToken` | `string` | — | Pre-existing ScribeMD API JWT (dev/testing path; no refresh possible). |
| `apiBaseUrl` | `string` | `https://www.scribemd.ai` | ScribeMD API origin. |
| `wsBaseUrl` | `string` | `wss://stt.scribemd.ai` | Transcription WebSocket origin. |
| `language` | `string` | `'en'` | Transcription + note language code. Also selects the built-in UI locale (`en`, `he`; RTL handled automatically for Hebrew/Arabic-script languages). |
| `onSessionRecovered` | `(encounterId: string) => void` | — | Crash recovery: called when a session interrupted by process death (host app killed mid-recording) was finalized on this mount. The note generates server-side; fetch it with `getEncounter` if you want to surface it. |
| `children` | `ReactNode` | — | Your app / the session UI. |

The auth context is also available directly via `useScribeMDAuth()` (status, `authorizedFetch`, `getAccessToken`, `getWebsocketToken`, `userConfig`) if you build custom flows.

### `<ScribeSession>`

Self-contained recording session card. Mount it full-screen or in a sheet, inside a `ScribeMDProvider`. It handles the mic permission prompt, live waveform + transcript, pause/resume, and note generation.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `onComplete` | `(result: ScribeSessionResult) => void` | yes | Fired when the session finishes (see payload below). Always fires after Stop — even when note generation fails, so the transcript is never lost. |
| `patientContext` | `PatientContext` | no | Read-only patient details shown in the header and stored on the ScribeMD encounter. |
| `noteTemplateId` | `string` | no | Preselects a note template for the session (e.g. chosen by your backend). Wins over the clinician's default; the clinician can still change it in the picker. Unset → clinician default → organization default. |
| `initialMode` | `'visit' \| 'dictation'` | no | Forces the initial recording mode. Default: the clinician's server-side preference. |
| `noteTemplateLocked` | `boolean` | no | Hides the template picker so the session is locked to `noteTemplateId`. |
| `initialContext` | `string` | no | Pre-fills the "Add context" field (the clinician can still edit it). |
| `autoStart` | `boolean` | no | Starts recording as soon as auth is ready — no idle screen. The mic permission prompt still applies. |
| `finishControl` | `FinishControlConfig` | no | Customizes the finish action: `{ variant: 'slide' \| 'button', label?, color?, textColor? }`. Default is the slide-to-finish (a deliberate drag can't be triggered by a stray tap); `'button'` renders a plain tap-to-finish button. |
| `noteReview` | `boolean` | no | Default `true`: after generation the clinician reviews the note in the SDK — editable sections (or a markdown editor), staged progress while generating, and `onComplete` fires only on **Approve & send**, with the edited note (also saved back to ScribeMD via `update_notes`). Set `false` to receive the raw note immediately and handle review in the host app. |
| `hideHeader` | `boolean` | no | Hides the SDK header chrome (title, patient chips, ✕) so your app renders its own — the recording timer stays. Pair with a **ref**: `ref.current.requestClose()` closes through the SDK's confirmation/discard logic (`ScribeSessionHandle`); `onCancel` fires after the user confirms. |
| `onError` | `(error: Error) => void` | no | Session/generation failures (see error contract, §8). |
| `onCancel` | `() => void` | no | When provided, a Cancel action is shown in the header; called after the user cancels. |
| `theme` | `ScribeSessionTheme` | no | `{ accentColor?, backgroundColor? }` — brand-color the record button/waveform/status accents and the card background. |

**Recording modes.** The session supports the same two modes as the ScribeMD apps, defaulting to the clinician's account preference (a pre-recording toggle is shown when their account allows switching):

- **Visit (`'visit'`)** — records the room audio as rolling 20-second WAV segments, uploaded to ScribeMD during the visit; the server batch-transcribes the full audio after Stop, then generates the note. No live transcript is shown. Most robust for real patient visits: the audio survives network drops and even the host app being killed (see offline behavior below).
- **Dictation (`'dictation'`)** — live streaming transcription with an on-screen transcript; the note is generated from the streamed transcript on Stop.

**Pre-recording options.** Before recording starts the session shows the mode toggle (when allowed), a note-template picker (the clinician's list, with their default or your `noteTemplateId` preselected) and an "Add context" free-text field stored on the encounter.

**Offline behavior / crash recovery.** Sessions are journaled to the app's Documents directory. Segments that fail to upload are retried during the session and at Stop; if the recording could not be submitted (offline) or the app is killed mid-visit, the SDK finalizes the session automatically on the next mount with connectivity and reports it via the provider's `onSessionRecovered`. Explicit Cancel discards the session.

```ts
interface PatientContext {
  patientId?: string;      // your (EHR) patient identifier
  medicalRecord?: string;  // MRN
  timestamp?: string;      // visit timestamp, free-form
}
```

#### `onComplete` payload — `ScribeSessionResult`

```ts
interface ScribeSessionResult {
  /**
   * Raw transcript — always present (may be '' for a silent session).
   * Visit mode: produced server-side by batch transcription and fetched
   * with the finished note.
   */
  transcript: string;
  /** ScribeMD encounter id, when an encounter was created for the session. */
  encounterId?: string;
  /** Generated clinical note. Absent when generation failed or timed out. */
  note?: GeneratedNote;
}

interface GeneratedNote {
  /** Markdown note (markdown-format templates). */
  markdown?: string;
  /** Sectioned note, e.g. { '1_Subjective': '...', '2_Objective': [...] }. */
  json?: { [section: string]: string | string[] };
  /** Plain-text rendering of the note. */
  plain?: string;
}
```

Which of `markdown` / `json` / `plain` is present depends on the clinician's configured note template; check all three (prefer `markdown`, fall back to `json`, then `plain`).

#### Theming

```tsx
<ScribeSession
  theme={{
    accentColor: '#0A7D62',        // primary/brand: record button, waveform, halos, selections
    backgroundColor: '#FFFFFF',    // session card background
    surfaceColor: '#F9FAFB',       // cards, inputs, toggle tracks, pills
    stopColor: '#111827',          // stop/finish controls
    textColor: '#111827',          // primary text (titles, transcript, timer)
    secondaryTextColor: '#6B7280', // labels, hints, muted text
  }}
  ...
/>
```

All keys are optional; anything unset falls back to the built-in neutral palette. Accent-derived tints (halos, selected states) are computed from your `accentColor` automatically.

#### Localization

Built-in locales: English and Hebrew (auto-selected from the provider `language`, including RTL transcript alignment). Override any string from your own i18n layer — host overrides always win:

```ts
import { setStrings } from '@scribemd-ai/mobile-sdk';

setStrings({ sessionTitle: 'Visit recording', stop: 'Finish' });
```

### Lower-level building blocks

If the embedded UI doesn't fit, the pieces it is built from are exported: `useWebSocketTranscription`, `useNoteGeneration`, `createEncounter` / `finalizeEncounter` / `getEncounter` / `extractGeneratedNote`, and the raw microphone module (`startStreaming`, `addAudioDataListener`, ...). See the TypeScript definitions in `src/index.ts` — most integrators should not need these.

---

## 8. Error handling contract

All failures surface through `onError`. The invariant: **the host never loses a transcript.**

1. **Auth / connection failures before recording starts** — `onError(error)` fires and the UI shows an error state with a Retry button. No `onComplete`.
2. **Microphone failure or connection loss mid-recording** — the session stays alive (a dismissable banner is shown for connection loss); `onError(error)` fires; the user can Stop and keep everything captured so far.
3. **Note generation failure or timeout after Stop (3-minute budget for dictation, 6 minutes for visit — batch transcription runs first)** — `onError` receives a `NoteGenerationFailedError`, **then** `onComplete` fires with the transcript (and `encounterId`) but no `note`:

```ts
import { NoteGenerationFailedError } from '@scribemd-ai/mobile-sdk';

onError={(error) => {
  if (error instanceof NoteGenerationFailedError) {
    // error.transcript   — full transcript, never lost
    // error.encounterId  — retry note generation later via the ScribeMD API
    // error.timedOut     — true when the generation budget elapsed (3 min dictation, 6 min visit)
  }
}}
```

`onComplete` is only skipped when the user cancels (`onCancel`) or a fatal error happens before any recording completes.

---

## 9. Complete minimal example

```tsx
import React, { useState } from 'react';
import { Alert, SafeAreaView, StyleSheet } from 'react-native';
import {
  ScribeMDProvider,
  ScribeSession,
  NoteGenerationFailedError,
  type ScribeSessionResult,
} from '@scribemd-ai/mobile-sdk';

// Fetched from YOUR backend, which called POST /ehrs/mobile/validate_user
// with the ScribeMD API key. Never embed the API key in the app.
const SESSION_TOKEN = '...';

export default function App(): React.JSX.Element {
  const [done, setDone] = useState(false);

  const handleComplete = (result: ScribeSessionResult) => {
    setDone(true);
    if (result.note?.markdown) {
      // Ship the note into your EHR flow.
      console.log('Clinical note:', result.note.markdown);
    } else {
      // Note missing (generation failed/timed out) — transcript is still here.
      console.log('Transcript only:', result.transcript);
    }
  };

  if (done) return <SafeAreaView style={styles.flex} />;

  return (
    <SafeAreaView style={styles.flex}>
      <ScribeMDProvider sessionToken={SESSION_TOKEN} language="en">
        <ScribeSession
          patientContext={{ patientId: 'patient-123', medicalRecord: 'MRN-0042' }}
          theme={{ accentColor: '#0A7D62' }}
          onComplete={handleComplete}
          onError={(error) => {
            if (error instanceof NoteGenerationFailedError) {
              // Transcript preserved on error.transcript; encounterId for retry.
              return;
            }
            Alert.alert('Scribe error', error.message);
          }}
          onCancel={() => setDone(true)}
        />
      </ScribeMDProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
```

A fuller runnable app (token entry form + session) lives in [`example-bare/`](example-bare/).

---

## 10. Support

Questions, API keys, or issues: dev@scribemd.ai.
