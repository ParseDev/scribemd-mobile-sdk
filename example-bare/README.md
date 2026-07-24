# ScribeBareExample

Bare (non-Expo) React Native app that consumes `@scribemd-ai/mobile-sdk`
from the repo root. It exists to prove that a plain RN client can install,
autolink, and run the SDK after adopting Expo Modules.

- React Native 0.85.3 (community CLI scaffold, not Expo)
- Expo Modules adopted via `install-expo-modules` (expo SDK 56)
- SDK consumed as a local symlink dependency

## Setup

Bun's `file:` protocol copies local packages (recursively — the repo root
contains this app), so the SDK is consumed via bun's `link:` protocol instead.
Register the link once per machine, then install:

```sh
# once per machine — registers the SDK in bun's global link registry
cd .. && bun link

cd example-bare
bun install
```

This leaves `node_modules/@scribemd-ai/mobile-sdk` as a symlink to the
repo root. `metro.config.js` adds the repo root to `watchFolders` and both
`node_modules` dirs to `resolver.nodeModulesPaths`, so SDK edits reload live.

## iOS

```sh
cd ios
bundle install        # first time only
bundle exec pod install
cd ..
bun run ios
```

`use_expo_modules!` in `ios/Podfile` autolinks the `MicrophoneStream` pod from
the SDK's `ios/MicrophoneStream.podspec`. `NSMicrophoneUsageDescription` is set
in `Info.plist`.

## Android

```sh
bun run android
```

Expo autolinking in `android/settings.gradle` picks up
`ai.scribemd.scribe.MicrophoneStreamModule` via the SDK's
`expo-module.config.json`. `RECORD_AUDIO`, `FOREGROUND_SERVICE`, and
`FOREGROUND_SERVICE_MICROPHONE` permissions are declared in the manifest.

## Using the app

Start metro with `bun run start`, launch the app, then enter either a session
session token (production path) or an API token (development path) plus a
patient id, and tap "Start scribe session". The transcript preview is shown in
an alert when the session completes.
