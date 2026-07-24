package ai.scribemd.scribe

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MicrophoneStreamModule : Module() {
    private var isStreaming = false
    private var isPaused = false

    override fun definition() = ModuleDefinition {
        Name("MicrophoneStream")

        // Events that will be sent to JavaScript
        Events("onAudioData", "onAudioLevel", "onError", "onStreamStateChange", "onFileRecordingComplete", "onAudioRouteChange")

        // Set up audio device callback on create
        OnCreate {
            MicrophoneStreamService.onAudioRouteChange = {
                sendAudioRouteChangeEvent()
            }
        }

        // Start streaming audio via foreground service
        AsyncFunction("startStreaming") { options: Map<String, Any>? ->
            startForegroundService()
        }

        // Stop streaming audio
        Function("stopStreaming") {
            stopForegroundService()
        }

        // Pause streaming (keeps recording but stops sending data)
        Function("pauseStreaming") {
            isPaused = true
            isStreaming = false
            sendPauseCommand()
            sendEvent("onStreamStateChange", mapOf("state" to "paused"))
        }

        // Resume streaming
        Function("resumeStreaming") {
            isPaused = false
            isStreaming = true
            sendResumeCommand()
            sendEvent("onStreamStateChange", mapOf("state" to "streaming"))
        }

        // Get current streaming state
        Function("isStreaming") {
            MicrophoneStreamService.isRunning && !isPaused
        }

        // Start keep-alive mode (foreground service without audio recording)
        // Used for visit mode to keep app alive in background
        AsyncFunction("startKeepAlive") {
            startKeepAliveService()
        }

        // Stop keep-alive mode
        Function("stopKeepAlive") {
            stopKeepAliveService()
        }

        // Check if in keep-alive mode
        Function("isKeepAliveMode") {
            MicrophoneStreamService.isKeepAliveMode
        }

        // Start recording to M4A file (while continuing to stream PCM)
        AsyncFunction("startFileRecording") { filePath: String ->
            startFileRecordingService(filePath)
        }

        // Stop file recording and return the file path
        AsyncFunction("stopFileRecording") {
            // Discard any stale path a previously timed-out stop left behind
            // — otherwise segment N's file gets attributed to segment N+1.
            MicrophoneStreamService.getAndClearLastFilePath()
            stopFileRecordingService()
            // The stop Intent is processed asynchronously; poll for the
            // completed path instead of a single fixed sleep so a busy
            // device doesn't silently drop the segment.
            var path: String? = null
            var waitedMs = 0
            while (path == null && waitedMs < 1500) {
                Thread.sleep(50)
                waitedMs += 50
                path = MicrophoneStreamService.getAndClearLastFilePath()
            }
            path
        }

        // Check if file recording is in progress
        Function("isFileRecording") {
            MicrophoneStreamService.isFileRecording
        }

        // Get available audio input devices
        Function("getAvailableInputs") {
            val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                devices.map { device ->
                    mapOf(
                        "uid" to device.id.toString(),
                        "name" to (device.productName?.toString() ?: getDeviceTypeName(device.type)),
                        "type" to getDeviceTypeName(device.type)
                    )
                }
            } else {
                emptyList()
            }
        }

        // Get current input (returns preferred device if set, otherwise first available)
        Function("getCurrentInput") {
            val context = appContext.reactContext ?: return@Function null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)

                // Return preferred device if set, otherwise first available
                val preferredId = MicrophoneStreamService.preferredDeviceId
                val device = if (preferredId != null) {
                    devices.find { it.id == preferredId }
                } else {
                    devices.firstOrNull()
                }

                device?.let {
                    mapOf(
                        "uid" to it.id.toString(),
                        "name" to (it.productName?.toString() ?: getDeviceTypeName(it.type)),
                        "type" to getDeviceTypeName(it.type)
                    )
                }
            } else {
                null
            }
        }

        // Set preferred input device
        AsyncFunction("setPreferredInput") { uid: String ->
            val deviceId = uid.toIntOrNull()
                ?: throw Exception("Invalid device ID")
            MicrophoneStreamService.setPreferredDeviceId(deviceId)
        }

        // Cleanup when module is destroyed
        OnDestroy {
            MicrophoneStreamService.onAudioRouteChange = null
            stopForegroundService()
        }
    }

    // Helper to map device type to readable name
    private fun getDeviceTypeName(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin_mic"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "usb_device"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
        else -> "unknown"
    }

    private fun sendAudioRouteChangeEvent() {
        val context = appContext.reactContext ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)

            val availableInputs = devices.map { device ->
                mapOf(
                    "uid" to device.id.toString(),
                    "name" to (device.productName?.toString() ?: getDeviceTypeName(device.type)),
                    "type" to getDeviceTypeName(device.type)
                )
            }

            // Get current input
            val preferredId = MicrophoneStreamService.preferredDeviceId
            val currentDevice = if (preferredId != null) {
                devices.find { it.id == preferredId }
            } else {
                devices.firstOrNull()
            }

            val currentInput = currentDevice?.let {
                mapOf(
                    "uid" to it.id.toString(),
                    "name" to (it.productName?.toString() ?: getDeviceTypeName(it.type)),
                    "type" to getDeviceTypeName(it.type)
                )
            }

            sendEvent("onAudioRouteChange", mapOf(
                "availableInputs" to availableInputs,
                "currentInput" to currentInput
            ))
        }
    }

    private fun startForegroundService() {
        if (MicrophoneStreamService.isRunning) {
            sendEvent("onError", mapOf("error" to "Audio streaming is already active"))
            return
        }

        val context = appContext.reactContext ?: return

        // Set up callbacks from service to module
        MicrophoneStreamService.onAudioData = { data ->
            sendEvent("onAudioData", mapOf("data" to data))
        }
        MicrophoneStreamService.onAudioLevel = { level ->
            sendEvent("onAudioLevel", mapOf("level" to level))
        }
        MicrophoneStreamService.onError = { error ->
            sendEvent("onError", mapOf("error" to error))
        }
        MicrophoneStreamService.onStateChange = { state ->
            when (state) {
                "streaming" -> {
                    isStreaming = true
                    isPaused = false
                }
                "paused" -> {
                    isStreaming = false
                    isPaused = true
                }
                "stopped" -> {
                    isStreaming = false
                    isPaused = false
                }
            }
            sendEvent("onStreamStateChange", mapOf("state" to state))
        }

        // Start foreground service
        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_START
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        isStreaming = true
        isPaused = false
    }

    private fun stopForegroundService() {
        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_STOP
        }
        context.startService(intent)

        // Clear callbacks
        MicrophoneStreamService.onAudioData = null
        MicrophoneStreamService.onAudioLevel = null
        MicrophoneStreamService.onError = null
        MicrophoneStreamService.onStateChange = null

        isStreaming = false
        isPaused = false
    }

    private fun sendPauseCommand() {
        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_PAUSE
        }
        context.startService(intent)
    }

    private fun sendResumeCommand() {
        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_RESUME
        }
        context.startService(intent)
    }

    private fun startKeepAliveService() {
        if (MicrophoneStreamService.isRunning) {
            // Already running (either recording or keep-alive)
            return
        }

        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_KEEP_ALIVE_START
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun stopKeepAliveService() {
        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_KEEP_ALIVE_STOP
        }
        context.startService(intent)
    }

    private fun startFileRecordingService(filePath: String) {
        val context = appContext.reactContext ?: return

        // Set up callback for file recording completion
        MicrophoneStreamService.onFileRecordingComplete = { completedPath ->
            sendEvent("onFileRecordingComplete", mapOf("filePath" to completedPath))
        }

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_START_FILE_RECORDING
            putExtra(MicrophoneStreamService.EXTRA_FILE_PATH, filePath)
        }
        context.startService(intent)
    }

    private fun stopFileRecordingService() {
        val context = appContext.reactContext ?: return

        val intent = Intent(context, MicrophoneStreamService::class.java).apply {
            action = MicrophoneStreamService.ACTION_STOP_FILE_RECORDING
        }
        context.startService(intent)
    }
}
