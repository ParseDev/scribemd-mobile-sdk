Pod::Spec.new do |s|
  s.name           = 'MicrophoneStream'
  s.version        = '0.1.0'
  s.summary        = 'ScribeMD embeddable medical scribe for React Native'
  s.description    = 'Native microphone streaming module for the ScribeMD SDK: PCM16 audio streaming, WAV file recording, audio route management, and background keep-alive.'
  s.author         = 'ScribeMD'
  s.homepage       = 'https://github.com/ParseDev/scribemd-sdk'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
