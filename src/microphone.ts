import { EventSubscription } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

import type {
  AudioDataEvent,
  AudioLevelEvent,
  StreamStateChangeEvent,
  ErrorEvent,
  StreamingOptions,
  FileRecordingCompleteEvent,
  AudioInputDevice,
  AudioRouteChangeEvent,
} from './MicrophoneStream.types';
import MicrophoneStreamModule from './MicrophoneStreamModule';

// Helper to safely check if module is available
function isModuleAvailable(): boolean {
  try {
    return MicrophoneStreamModule != null && typeof MicrophoneStreamModule === 'object';
  } catch (error) {
    console.warn('[MicrophoneStream] Module not available:', error);
    return false;
  }
}

// Export types
export type {
  AudioDataEvent,
  AudioLevelEvent,
  StreamStateChangeEvent,
  ErrorEvent,
  StreamingOptions,
  FileRecordingCompleteEvent,
  AudioInputDevice,
  AudioRouteChangeEvent,
};

// Event listeners
export function addAudioDataListener(listener: (event: AudioDataEvent) => void): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot add audio data listener');
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onAudioData', listener);
    }
    console.warn('[MicrophoneStream] addAudioDataListener() not available on this platform');
    // Return a dummy subscription that can be removed
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addAudioDataListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

export function addAudioLevelListener(
  listener: (event: AudioLevelEvent) => void
): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot add audio level listener');
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onAudioLevel', listener);
    }
    console.warn('[MicrophoneStream] addAudioLevelListener() not available on this platform');
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addAudioLevelListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

export function addStreamStateChangeListener(
  listener: (event: StreamStateChangeEvent) => void
): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn(
      '[MicrophoneStream] Module not available, cannot add stream state change listener'
    );
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onStreamStateChange', listener);
    }
    console.warn(
      '[MicrophoneStream] addStreamStateChangeListener() not available on this platform'
    );
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addStreamStateChangeListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

export function addErrorListener(listener: (event: ErrorEvent) => void): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot add error listener');
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onError', listener);
    }
    console.warn('[MicrophoneStream] addErrorListener() not available on this platform');
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addErrorListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

// Streaming controls
export async function startStreaming(options?: StreamingOptions): Promise<void> {
  // Android never auto-prompts for RECORD_AUDIO (iOS does via TCC): without
  // this request, first-run sessions fail inside the foreground service
  // with an opaque SecurityException. Throws so the session start fails
  // cleanly when the user denies.
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Microphone permission was not granted.');
    }
  }
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot start streaming');
    return Promise.resolve();
  }
  try {
    if (typeof MicrophoneStreamModule.startStreaming === 'function') {
      return await MicrophoneStreamModule.startStreaming(options);
    }
    console.warn('[MicrophoneStream] startStreaming() not available on this platform');
    return Promise.resolve();
  } catch (error) {
    console.warn('[MicrophoneStream] startStreaming() error:', error);
    return Promise.resolve();
  }
}

export function stopStreaming(): void {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot stop streaming');
    return;
  }
  try {
    if (typeof MicrophoneStreamModule.stopStreaming === 'function') {
      return MicrophoneStreamModule.stopStreaming();
    }
    console.warn('[MicrophoneStream] stopStreaming() not available on this platform');
  } catch (error) {
    console.warn('[MicrophoneStream] stopStreaming() error:', error);
  }
}

export function pauseStreaming(): void {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot pause streaming');
    return;
  }
  try {
    if (typeof MicrophoneStreamModule.pauseStreaming === 'function') {
      return MicrophoneStreamModule.pauseStreaming();
    }
    console.warn('[MicrophoneStream] pauseStreaming() not available on this platform');
  } catch (error) {
    console.warn('[MicrophoneStream] pauseStreaming() error:', error);
  }
}

export function resumeStreaming(): void {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot resume streaming');
    return;
  }
  try {
    if (typeof MicrophoneStreamModule.resumeStreaming === 'function') {
      return MicrophoneStreamModule.resumeStreaming();
    }
    console.warn('[MicrophoneStream] resumeStreaming() not available on this platform');
  } catch (error) {
    console.warn('[MicrophoneStream] resumeStreaming() error:', error);
  }
}

export function isStreaming(): boolean {
  if (!isModuleAvailable()) {
    return false;
  }
  try {
    // Check if the method exists (Android might not have it implemented yet)
    if (typeof MicrophoneStreamModule.isStreaming === 'function') {
      return MicrophoneStreamModule.isStreaming();
    }
    // If method doesn't exist, assume not streaming
    return false;
  } catch (error) {
    console.warn('[MicrophoneStream] isStreaming() not available:', error);
    return false;
  }
}

// Keep-alive mode (foreground service without audio recording)
// Used for visit mode to keep app alive in background on Android
export async function startKeepAlive(): Promise<void> {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot start keep-alive');
    return Promise.resolve();
  }
  try {
    if (typeof MicrophoneStreamModule.startKeepAlive === 'function') {
      return await MicrophoneStreamModule.startKeepAlive();
    }
    console.warn('[MicrophoneStream] startKeepAlive() not available on this platform');
    return Promise.resolve();
  } catch (error) {
    console.warn('[MicrophoneStream] startKeepAlive() error:', error);
    return Promise.resolve();
  }
}

export function stopKeepAlive(): void {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot stop keep-alive');
    return;
  }
  try {
    if (typeof MicrophoneStreamModule.stopKeepAlive === 'function') {
      return MicrophoneStreamModule.stopKeepAlive();
    }
    console.warn('[MicrophoneStream] stopKeepAlive() not available on this platform');
  } catch (error) {
    console.warn('[MicrophoneStream] stopKeepAlive() error:', error);
  }
}

export function isKeepAliveMode(): boolean {
  if (!isModuleAvailable()) {
    return false;
  }
  try {
    if (typeof MicrophoneStreamModule.isKeepAliveMode === 'function') {
      return MicrophoneStreamModule.isKeepAliveMode();
    }
    return false;
  } catch (error) {
    console.warn('[MicrophoneStream] isKeepAliveMode() not available:', error);
    return false;
  }
}

// M4A/AAC File Recording
// Records audio to M4A file while continuing to stream PCM data

export function addFileRecordingCompleteListener(
  listener: (event: FileRecordingCompleteEvent) => void
): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn(
      '[MicrophoneStream] Module not available, cannot add file recording complete listener'
    );
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onFileRecordingComplete', listener);
    }
    console.warn(
      '[MicrophoneStream] addFileRecordingCompleteListener() not available on this platform'
    );
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addFileRecordingCompleteListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

export async function startFileRecording(filePath: string): Promise<void> {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot start file recording');
    return Promise.resolve();
  }
  try {
    if (typeof MicrophoneStreamModule.startFileRecording === 'function') {
      return await MicrophoneStreamModule.startFileRecording(filePath);
    }
    console.warn('[MicrophoneStream] startFileRecording() not available on this platform');
    return Promise.resolve();
  } catch (error) {
    console.warn('[MicrophoneStream] startFileRecording() error:', error);
    return Promise.resolve();
  }
}

export async function stopFileRecording(): Promise<string | null> {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot stop file recording');
    return null;
  }
  try {
    if (typeof MicrophoneStreamModule.stopFileRecording === 'function') {
      const filePath = await MicrophoneStreamModule.stopFileRecording();
      return filePath ?? null;
    }
    console.warn('[MicrophoneStream] stopFileRecording() not available on this platform');
    return null;
  } catch (error) {
    console.warn('[MicrophoneStream] stopFileRecording() error:', error);
    return null;
  }
}

export function isFileRecording(): boolean {
  if (!isModuleAvailable()) {
    return false;
  }
  try {
    if (typeof MicrophoneStreamModule.isFileRecording === 'function') {
      return MicrophoneStreamModule.isFileRecording();
    }
    return false;
  } catch (error) {
    console.warn('[MicrophoneStream] isFileRecording() not available:', error);
    return false;
  }
}

// Audio Input Device Selection

export function getAvailableInputs(): AudioInputDevice[] {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot get available inputs');
    return [];
  }
  try {
    if (typeof MicrophoneStreamModule.getAvailableInputs === 'function') {
      return MicrophoneStreamModule.getAvailableInputs() ?? [];
    }
    console.warn('[MicrophoneStream] getAvailableInputs() not available on this platform');
    return [];
  } catch (error) {
    console.warn('[MicrophoneStream] getAvailableInputs() error:', error);
    return [];
  }
}

export function getCurrentInput(): AudioInputDevice | null {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot get current input');
    return null;
  }
  try {
    if (typeof MicrophoneStreamModule.getCurrentInput === 'function') {
      return MicrophoneStreamModule.getCurrentInput() ?? null;
    }
    console.warn('[MicrophoneStream] getCurrentInput() not available on this platform');
    return null;
  } catch (error) {
    console.warn('[MicrophoneStream] getCurrentInput() error:', error);
    return null;
  }
}

export async function setPreferredInput(uid: string): Promise<void> {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot set preferred input');
    return;
  }
  try {
    if (typeof MicrophoneStreamModule.setPreferredInput === 'function') {
      await MicrophoneStreamModule.setPreferredInput(uid);
      return;
    }
    console.warn('[MicrophoneStream] setPreferredInput() not available on this platform');
  } catch (error) {
    console.warn('[MicrophoneStream] setPreferredInput() error:', error);
    throw error;
  }
}

export function addAudioRouteChangeListener(
  listener: (event: AudioRouteChangeEvent) => void
): EventSubscription {
  if (!isModuleAvailable()) {
    console.warn('[MicrophoneStream] Module not available, cannot add audio route change listener');
    return { remove: () => {} } as EventSubscription;
  }
  try {
    if (typeof MicrophoneStreamModule.addListener === 'function') {
      return MicrophoneStreamModule.addListener('onAudioRouteChange', listener);
    }
    console.warn('[MicrophoneStream] addAudioRouteChangeListener() not available on this platform');
    return { remove: () => {} } as EventSubscription;
  } catch (error) {
    console.warn('[MicrophoneStream] addAudioRouteChangeListener() error:', error);
    return { remove: () => {} } as EventSubscription;
  }
}

// App Intent Support (iOS Shortcuts / Action Button)
// Returns and clears any pending App Intent action
export function getPendingAppIntent(): string | null {
  if (!isModuleAvailable()) {
    return null;
  }
  try {
    if (typeof MicrophoneStreamModule.getPendingAppIntent === 'function') {
      return MicrophoneStreamModule.getPendingAppIntent() ?? null;
    }
    return null;
  } catch (error) {
    console.warn('[MicrophoneStream] getPendingAppIntent() error:', error);
    return null;
  }
}
