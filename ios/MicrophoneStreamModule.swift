import ExpoModulesCore
import AVFoundation

public class MicrophoneStreamModule: Module {
  // Audio engine and nodes
  private var audioEngine: AVAudioEngine?
  private var inputNode: AVAudioInputNode?
  private var isStreaming = false
  private var isKeepAliveActive = false

  // Audio format settings - 16kHz, mono, PCM16 (optimal for most transcription services)
  private let sampleRate: Double = 16000
  private let channels: AVAudioChannelCount = 1

  // M4A/AAC file recording using AVAudioFile
  private var audioFile: AVAudioFile?
  private var isFileRecording = false
  private var currentFilePath: String?
  private var encodedBufferCount = 0
  private let fileWriteQueue = DispatchQueue(label: "com.microphonestream.filewrite", qos: .userInitiated)

  // Route change observer for audio device changes
  private var routeChangeObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var wasStreamingBeforeInterruption = false

  // EMA smoothing for audio level
  private var smoothedAudioLevel: Float = 0.0
  private let smoothingAlpha: Float = 0.3  // EMA factor (0.2-0.4 works well)

  public func definition() -> ModuleDefinition {
    Name("MicrophoneStream")

    // Events that will be sent to JavaScript
    Events("onAudioData", "onAudioLevel", "onError", "onStreamStateChange", "onFileRecordingComplete", "onAudioRouteChange")

    // Set up route change observer when module is created
    OnCreate {
      self.routeChangeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self = self else { return }
        self.sendRouteChangeEvent()
      }
      // Phone calls / Siri / other apps interrupt the audio session; without
      // this observer the engine stays dead after the interruption ends and
      // recording silently never resumes.
      self.interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        self?.handleAudioInterruption(notification)
      }
    }

    // Start streaming audio
    AsyncFunction("startStreaming") { (options: [String: Any]?) in
      try self.startAudioStreaming(options: options)
    }

    // Stop streaming audio
    Function("stopStreaming") {
      self.stopAudioStreaming()
    }

    // Pause streaming (keeps engine running but stops sending data)
    Function("pauseStreaming") {
      self.isStreaming = false
      self.sendEvent("onStreamStateChange", ["state": "paused"])
    }

    // Resume streaming
    Function("resumeStreaming") {
      self.isStreaming = true
      self.sendEvent("onStreamStateChange", ["state": "streaming"])
    }

    // Get current streaming state
    Function("isStreaming") {
      return self.isStreaming
    }

    // Start keep-alive mode (audio session active but no recording)
    // Used for visit mode to keep app active in background
    AsyncFunction("startKeepAlive") {
      try self.startKeepAliveMode()
    }

    // Stop keep-alive mode
    Function("stopKeepAlive") {
      self.stopKeepAliveMode()
    }

    // Check if in keep-alive mode
    Function("isKeepAliveMode") {
      return self.isKeepAliveActive
    }

    // Start recording to M4A file (while continuing to stream PCM)
    AsyncFunction("startFileRecording") { (filePath: String) in
      try self.startFileRecording(filePath: filePath)
    }

    // Stop file recording and return the file path
    AsyncFunction("stopFileRecording") { () -> String? in
      return self.stopFileRecordingSync()
    }

    // Check if file recording is in progress
    Function("isFileRecording") {
      return self.isFileRecording
    }

    // Get available audio input devices
    Function("getAvailableInputs") { () -> [[String: Any]] in
      let session = AVAudioSession.sharedInstance()
      guard let inputs = session.availableInputs else { return [] }
      return inputs.map { port in
        return [
          "uid": port.uid,
          "name": port.portName,
          "type": port.portType.rawValue,
        ]
      }
    }

    // Get current active input
    Function("getCurrentInput") { () -> [String: Any]? in
      let session = AVAudioSession.sharedInstance()
      guard let input = session.currentRoute.inputs.first else { return nil }
      return [
        "uid": input.uid,
        "name": input.portName,
        "type": input.portType.rawValue,
      ]
    }

    // Set preferred input by UID
    AsyncFunction("setPreferredInput") { (uid: String) in
      let session = AVAudioSession.sharedInstance()
      guard let inputs = session.availableInputs,
            let port = inputs.first(where: { $0.uid == uid }) else {
        throw NSError(domain: "MicrophoneStream", code: 10,
                      userInfo: [NSLocalizedDescriptionKey: "Input device not found"])
      }
      try session.setPreferredInput(port)
    }

    // Get and clear pending App Intent (from Shortcuts/Action Button).
    // Returns the intent name if one is pending, or null if none.
    //
    // The App Group suite is read from the host app's Info.plist key
    // `ScribeMDAppGroup`. Hosts that wire up a Shortcuts/Action Button
    // intent set this to their own App Group; when it is absent this
    // hook is inert and returns nil.
    Function("getPendingAppIntent") { () -> String? in
      guard let appGroupIdentifier = Bundle.main.object(
        forInfoDictionaryKey: "ScribeMDAppGroup") as? String,
        !appGroupIdentifier.isEmpty else {
        return nil
      }
      let pendingIntentKey = "pendingAppIntent"

      guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
        return nil
      }

      let intent = defaults.string(forKey: pendingIntentKey)

      // Clear the pending intent after reading
      if intent != nil {
        defaults.removeObject(forKey: pendingIntentKey)
        defaults.synchronize()
      }

      return intent
    }

    // Cleanup when module is deallocated
    OnDestroy {
      if let observer = self.routeChangeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      if let observer = self.interruptionObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.stopAudioStreaming()
      self.stopKeepAliveMode()
      self.cleanupAudioFile()
    }
  }

  // MARK: - Audio Session Interruptions

  private func handleAudioInterruption(_ notification: Notification) {
    guard let info = notification.userInfo,
          let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

    switch type {
    case .began:
      // Engine is stopped by the system; remember what we were doing so
      // .ended can restore it. File recording state is left intact — the
      // WAV simply has no frames appended during the interruption.
      guard audioEngine != nil else { return }
      wasStreamingBeforeInterruption = isStreaming
      sendEvent("onStreamStateChange", ["state": "interrupted"])

    case .ended:
      guard let engine = audioEngine else { return }
      let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
      guard options.contains(.shouldResume) else {
        // System says don't resume (e.g. another app took the session for
        // good) — surface it so the UI can show the failure.
        sendEvent("onError", ["error": "Audio session was interrupted and could not be resumed."])
        return
      }
      do {
        try AVAudioSession.sharedInstance().setActive(true, options: [])
        if !engine.isRunning {
          try engine.start()
        }
        isStreaming = wasStreamingBeforeInterruption
        sendEvent("onStreamStateChange", ["state": isStreaming ? "streaming" : "paused"])
      } catch {
        sendEvent("onError", ["error": "Failed to resume after audio interruption: \(error.localizedDescription)"])
      }

    @unknown default:
      break
    }
  }

  // MARK: - Audio Streaming Implementation

  private func startAudioStreaming(options: [String: Any]?) throws {
    // Check if already streaming
    if isStreaming {
      throw NSError(domain: "MicrophoneStream", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Audio streaming is already active"
      ])
    }

    // Request microphone permission
    let audioSession = AVAudioSession.sharedInstance()

    // Configure audio session for background recording
    do {
      // Use .playAndRecord category with .defaultToSpeaker option for background support
      // .record category alone doesn't support background on all iOS versions
      // .playAndRecord with .defaultToSpeaker allows background recording
      try audioSession.setCategory(
        .playAndRecord,
        mode: .measurement,
        options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
      )

      // Enable background audio
      try audioSession.setActive(true, options: [])

      // Request background audio permission (iOS 13+)
      if #available(iOS 13.0, *) {
        // This ensures the app can continue recording in background
        // The UIBackgroundModes in Info.plist is also required
      }
    } catch {
      self.sendEvent("onError", ["error": "Failed to configure audio session: \(error.localizedDescription)"])
      throw error
    }

    // Initialize audio engine
    audioEngine = AVAudioEngine()
    guard let audioEngine = audioEngine else {
      throw NSError(domain: "MicrophoneStream", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "Failed to create audio engine"
      ])
    }

    inputNode = audioEngine.inputNode
    guard let inputNode = inputNode else {
      throw NSError(domain: "MicrophoneStream", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "Failed to get input node"
      ])
    }

    // Get the input format (native hardware format)
    let inputFormat = inputNode.outputFormat(forBus: 0)

    // Define the desired format for transcription (16kHz, mono, PCM16)
    guard let recordingFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: sampleRate,
      channels: channels,
      interleaved: true
    ) else {
      throw NSError(domain: "MicrophoneStream", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "Failed to create recording format"
      ])
    }

    // Create a converter if needed (from native hardware format to our desired format)
    guard let converter = AVAudioConverter(from: inputFormat, to: recordingFormat) else {
      throw NSError(domain: "MicrophoneStream", code: 5, userInfo: [
        NSLocalizedDescriptionKey: "Failed to create audio converter"
      ])
    }

    // Install tap on the input node to capture audio
    let bufferSize: AVAudioFrameCount = 4096 // ~256ms at 16kHz

    inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] (buffer, time) in
      guard let self = self, self.isStreaming else { return }

      // Convert to our desired format
      self.processAudioBuffer(buffer, converter: converter, outputFormat: recordingFormat)
    }

    // Start the audio engine
    do {
      try audioEngine.start()
      isStreaming = true
      self.sendEvent("onStreamStateChange", ["state": "streaming"])
    } catch {
      self.sendEvent("onError", ["error": "Failed to start audio engine: \(error.localizedDescription)"])
      throw error
    }
  }

  private func stopAudioStreaming() {
    guard let audioEngine = audioEngine, let inputNode = inputNode else { return }

    // Remove tap and stop engine
    inputNode.removeTap(onBus: 0)
    audioEngine.stop()

    isStreaming = false
    self.audioEngine = nil
    self.inputNode = nil

    // Deactivate audio session (only if not in keep-alive mode)
    if !isKeepAliveActive {
      do {
        try AVAudioSession.sharedInstance().setActive(false)
      } catch {
        self.sendEvent("onError", ["error": "Failed to deactivate audio session: \(error.localizedDescription)"])
      }
    }

    self.sendEvent("onStreamStateChange", ["state": "stopped"])
  }

  // MARK: - Keep-Alive Mode Implementation

  private func startKeepAliveMode() throws {
    // If already streaming or in keep-alive, do nothing
    if isStreaming || isKeepAliveActive {
      return
    }

    let audioSession = AVAudioSession.sharedInstance()

    // Configure audio session for background - just keep it active
    // This allows expo-audio to continue recording in background
    do {
      try audioSession.setCategory(
        .playAndRecord,
        mode: .default,
        options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
      )
      try audioSession.setActive(true, options: [])
      isKeepAliveActive = true
      print("[MicrophoneStream] Keep-alive mode started")
    } catch {
      self.sendEvent("onError", ["error": "Failed to start keep-alive mode: \(error.localizedDescription)"])
      throw error
    }
  }

  private func stopKeepAliveMode() {
    guard isKeepAliveActive else { return }

    isKeepAliveActive = false

    // Only deactivate audio session if not streaming
    if !isStreaming {
      do {
        try AVAudioSession.sharedInstance().setActive(false)
      } catch {
        self.sendEvent("onError", ["error": "Failed to stop keep-alive mode: \(error.localizedDescription)"])
      }
    }

    print("[MicrophoneStream] Keep-alive mode stopped")
  }

  private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, outputFormat: AVAudioFormat) {
    // Calculate the required output buffer capacity
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * (outputFormat.sampleRate / buffer.format.sampleRate))

    guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
      return
    }

    var error: NSError?
    let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
      outStatus.pointee = .haveData
      return buffer
    }

    converter.convert(to: convertedBuffer, error: &error, withInputFrom: inputBlock)

    if let error = error {
      self.sendEvent("onError", ["error": "Audio conversion error: \(error.localizedDescription)"])
      return
    }

    // Calculate audio level (RMS) for visualization
    let audioLevel = self.calculateAudioLevel(buffer: convertedBuffer)
    self.sendEvent("onAudioLevel", ["level": audioLevel])

    // Convert to Data and encode as Base64
    if let int16ChannelData = convertedBuffer.int16ChannelData {
      let channelData = int16ChannelData[0]
      let dataSize = Int(convertedBuffer.frameLength) * MemoryLayout<Int16>.size
      let data = Data(bytes: channelData, count: dataSize)

      // Send as Base64 encoded string (for real-time streaming)
      let base64String = data.base64EncodedString()

      self.sendEvent("onAudioData", [
        "data": base64String,
        "frameLength": convertedBuffer.frameLength,
        "sampleRate": outputFormat.sampleRate,
        "channels": outputFormat.channelCount,
        "timestamp": Date().timeIntervalSince1970 * 1000 // milliseconds
      ])

      // Also write to file if file recording is active
      if isFileRecording {
        writeBufferToFile(convertedBuffer)
      }
    }
  }

  private func calculateAudioLevel(buffer: AVAudioPCMBuffer) -> Float {
    guard let channelData = buffer.int16ChannelData else {
      print("[MicrophoneStream] No channel data")
      return smoothedAudioLevel
    }

    let channelDataPointer = channelData[0]
    let frameLength = Int(buffer.frameLength)

    // Calculate RMS (Root Mean Square) - sum of squares of all samples
    var sumOfSquares: Float = 0.0
    for i in 0..<frameLength {
      let sample = Float(channelDataPointer[i])
      sumOfSquares += sample * sample
    }

    let rms = sqrt(sumOfSquares / Float(frameLength))

    // Normalize to 0-1 range (Int16 max is 32767)
    let normalizedLevel = rms / Float(Int16.max)

    // Convert to dB scale (-60 to 0)
    let db = 20 * log10(max(normalizedLevel, 0.000001)) // Avoid log(0)
    let normalizedDb = max(0, min(1, (db + 60) / 60)) // Normalize from -60dB...0dB to 0...1

    // Apply EMA smoothing for smoother visualization
    smoothedAudioLevel = smoothingAlpha * normalizedDb + (1 - smoothingAlpha) * smoothedAudioLevel

    // Debug logging (log every 10th buffer to avoid spam)
    if Int.random(in: 0..<10) == 0 {
      print("[MicrophoneStream] Frames: \(frameLength) | RMS: \(String(format: "%.2f", rms)) | Norm: \(String(format: "%.4f", normalizedLevel)) | dB: \(String(format: "%.2f", db)) | Smoothed: \(String(format: "%.4f", smoothedAudioLevel))")
    }

    return smoothedAudioLevel
  }

  // MARK: - Audio Route Change Helper

  private func sendRouteChangeEvent() {
    let session = AVAudioSession.sharedInstance()

    // Get available inputs
    var availableInputs: [[String: Any]] = []
    if let inputs = session.availableInputs {
      availableInputs = inputs.map { port in
        return [
          "uid": port.uid,
          "name": port.portName,
          "type": port.portType.rawValue,
        ]
      }
    }

    // Get current input
    var currentInput: [String: Any]? = nil
    if let input = session.currentRoute.inputs.first {
      currentInput = [
        "uid": input.uid,
        "name": input.portName,
        "type": input.portType.rawValue,
      ]
    }

    self.sendEvent("onAudioRouteChange", [
      "availableInputs": availableInputs,
      "currentInput": currentInput as Any
    ])
  }

  // MARK: - WAV File Recording Implementation using AVAudioFile

  private func startFileRecording(filePath: String) throws {
    if isFileRecording {
      print("[MicrophoneStream] File recording already in progress")
      return
    }

    // Parse the file path - handle both file:// URLs and regular paths
    var actualFilePath = filePath
    if filePath.hasPrefix("file://") {
      if let url = URL(string: filePath) {
        actualFilePath = url.path
      }
    }

    // Change extension to .wav (AVAudioFile supports WAV reliably)
    actualFilePath = (actualFilePath as NSString).deletingPathExtension + ".wav"

    print("[MicrophoneStream] Starting file recording to: \(actualFilePath)")

    let fileURL = URL(fileURLWithPath: actualFilePath)

    // Remove existing file if any
    try? FileManager.default.removeItem(at: fileURL)

    // Create parent directory if needed
    let parentDir = fileURL.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true)

    // Create format for WAV output (PCM16, 16kHz, mono)
    // This is reliable and works well with AVAudioFile
    let outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false
    ]

    do {
      // Create AVAudioFile for writing WAV
      audioFile = try AVAudioFile(
        forWriting: fileURL,
        settings: outputSettings,
        commonFormat: .pcmFormatInt16,
        interleaved: true
      )

      currentFilePath = actualFilePath
      encodedBufferCount = 0
      isFileRecording = true

      print("[MicrophoneStream] File recording started successfully to: \(actualFilePath)")
    } catch {
      print("[MicrophoneStream] Failed to create audio file: \(error.localizedDescription)")
      self.sendEvent("onError", ["error": "Failed to create audio file: \(error.localizedDescription)"])
      throw error
    }
  }

  private func stopFileRecordingSync() -> String? {
    guard isFileRecording else {
      print("[MicrophoneStream] No file recording in progress")
      return nil
    }

    print("[MicrophoneStream] Stopping WAV file recording, encoded buffers: \(encodedBufferCount)")

    isFileRecording = false
    let filePath = currentFilePath

    // Close the audio file (this finalizes the encoding)
    // AVAudioFile automatically closes when deallocated, but we explicitly set to nil
    audioFile = nil

    // Verify file exists and get size
    if let path = filePath {
      if FileManager.default.fileExists(atPath: path) {
        if let attrs = try? FileManager.default.attributesOfItem(atPath: path) {
          let fileSize = attrs[.size] as? Int64 ?? 0
          print("[MicrophoneStream] File recording completed: \(path), size: \(fileSize) bytes")
          self.sendEvent("onFileRecordingComplete", ["filePath": path])
          cleanupAudioFile()
          return path
        }
      } else {
        print("[MicrophoneStream] File was not created at path: \(path)")
      }
    }

    let errorMsg = "File recording failed - file not found"
    print("[MicrophoneStream] \(errorMsg)")
    self.sendEvent("onError", ["error": errorMsg])
    cleanupAudioFile()
    return nil
  }

  private func writeBufferToFile(_ buffer: AVAudioPCMBuffer) {
    guard isFileRecording, let audioFile = audioFile else { return }

    do {
      // Write Int16 buffer directly to WAV file
      try audioFile.write(from: buffer)
      encodedBufferCount += 1
      if encodedBufferCount % 50 == 0 {
        print("[MicrophoneStream] Written \(encodedBufferCount) buffers to WAV, frames: \(audioFile.length)")
      }
    } catch {
      print("[MicrophoneStream] Failed to write buffer to file: \(error.localizedDescription)")
    }
  }

  private func cleanupAudioFile() {
    audioFile = nil
    currentFilePath = nil
    encodedBufferCount = 0
  }
}
