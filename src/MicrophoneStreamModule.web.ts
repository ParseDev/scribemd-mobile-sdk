import { registerWebModule, NativeModule } from 'expo';

import { MicrophoneStreamModuleEvents } from './MicrophoneStream.types';

// Web stub — native microphone streaming is not available on web.
// The index.ts wrappers detect missing methods and no-op gracefully.
class MicrophoneStreamModule extends NativeModule<MicrophoneStreamModuleEvents> {}

export default registerWebModule(MicrophoneStreamModule, 'MicrophoneStreamModule');
