export type AudioDataEvent = {
  data: string; // Base64 encoded PCM16 audio data
  frameLength: number;
  sampleRate: number;
  channels: number;
  timestamp: number; // Unix timestamp in milliseconds
};

export type AudioLevelEvent = {
  level: number; // Normalized audio level 0-1
};

export type StreamStateChangeEvent = {
  state: 'streaming' | 'paused' | 'stopped';
};

export type ErrorEvent = {
  error: string;
};

export type FileRecordingCompleteEvent = {
  filePath: string;
};

export type AudioInputDevice = {
  uid: string;
  name: string;
  type: string; // 'builtin_mic', 'bluetooth_sco', 'wired_headset', etc.
};

export type AudioRouteChangeEvent = {
  availableInputs: AudioInputDevice[];
  currentInput: AudioInputDevice | null;
};

export type MicrophoneStreamModuleEvents = {
  onAudioData: (event: AudioDataEvent) => void;
  onAudioLevel: (event: AudioLevelEvent) => void;
  onStreamStateChange: (event: StreamStateChangeEvent) => void;
  onError: (event: ErrorEvent) => void;
  onFileRecordingComplete: (event: FileRecordingCompleteEvent) => void;
  onAudioRouteChange: (event: AudioRouteChangeEvent) => void;
};

export type StreamingOptions = {
  sampleRate?: number; // Default: 16000
  channels?: number; // Default: 1 (mono)
  bufferSize?: number; // Default: 4096
};
