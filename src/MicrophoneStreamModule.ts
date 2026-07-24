import { NativeModule, requireNativeModule } from 'expo';

import {
  AudioInputDevice,
  MicrophoneStreamModuleEvents,
  StreamingOptions,
} from './MicrophoneStream.types';

declare class MicrophoneStreamModule extends NativeModule<MicrophoneStreamModuleEvents> {
  startStreaming(options?: StreamingOptions): Promise<void>;
  stopStreaming(): void;
  pauseStreaming(): void;
  resumeStreaming(): void;
  isStreaming(): boolean;
  startKeepAlive(): Promise<void>;
  stopKeepAlive(): void;
  isKeepAliveMode(): boolean;
  startFileRecording(filePath: string): Promise<void>;
  stopFileRecording(): Promise<string | null>;
  isFileRecording(): boolean;
  getAvailableInputs(): AudioInputDevice[];
  getCurrentInput(): AudioInputDevice | null;
  setPreferredInput(uid: string): Promise<void>;
  getPendingAppIntent(): string | null;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<MicrophoneStreamModule>('MicrophoneStream');
