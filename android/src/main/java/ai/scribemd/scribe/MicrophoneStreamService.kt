package ai.scribemd.scribe

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

class MicrophoneStreamService : Service() {
    companion object {
        private const val TAG = "MicrophoneStreamService"
        private const val CHANNEL_ID = "scribemd_recording_channel"
        private const val NOTIFICATION_ID = 1001

        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"
        const val ACTION_PAUSE = "PAUSE"
        const val ACTION_RESUME = "RESUME"
        const val ACTION_KEEP_ALIVE_START = "KEEP_ALIVE_START"
        const val ACTION_KEEP_ALIVE_STOP = "KEEP_ALIVE_STOP"
        const val ACTION_START_FILE_RECORDING = "START_FILE_RECORDING"
        const val ACTION_STOP_FILE_RECORDING = "STOP_FILE_RECORDING"
        const val EXTRA_FILE_PATH = "FILE_PATH"

        // Callbacks for sending data to the module
        var onAudioData: ((String) -> Unit)? = null
        var onAudioLevel: ((Double) -> Unit)? = null
        var onError: ((String) -> Unit)? = null
        var onStateChange: ((String) -> Unit)? = null
        var onFileRecordingComplete: ((String) -> Unit)? = null
        var onAudioRouteChange: (() -> Unit)? = null

        var isRunning = false
            private set

        var isKeepAliveMode = false
            private set

        var isFileRecording = false
            private set

        // Store the last completed file path for synchronous retrieval.
        // @Volatile: written on the service main thread, read (polled) from
        // the Expo async-function thread.
        @Volatile
        var lastCompletedFilePath: String? = null
            private set

        // Preferred audio device ID
        var preferredDeviceId: Int? = null
            private set

        fun setPreferredDeviceId(id: Int?) {
            preferredDeviceId = id
            // If already recording, update the AudioRecord device
            instance?.updatePreferredDevice()
        }

        fun getAndClearLastFilePath(): String? {
            val path = lastCompletedFilePath
            lastCompletedFilePath = null
            return path
        }

        private var instance: MicrophoneStreamService? = null
    }

    private var audioRecord: AudioRecord? = null
    private var isStreaming = false
    private var isPaused = false
    private var recordingJob: Job? = null
    private val recordingScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null

    // Audio format settings - 16kHz, mono, PCM16
    private val sampleRate = 16000
    private val channelConfig = AudioFormat.CHANNEL_IN_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    private val bufferSize by lazy {
        AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat) * 2
    }

    // WAV file recording
    private var wavOutputStream: FileOutputStream? = null
    private var currentFilePath: String? = null
    private var totalAudioBytes: Long = 0

    // Audio device callback for route changes
    private var audioDeviceCallback: AudioDeviceCallback? = null

    // EMA smoothing for audio level
    private var smoothedAudioLevel: Double = 0.0
    private val smoothingAlpha = 0.3

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "Service created")
        createNotificationChannel()
        registerAudioDeviceCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: ${intent?.action}")

        when (intent?.action) {
            ACTION_START -> startRecording()
            ACTION_STOP -> stopRecording()
            ACTION_PAUSE -> pauseRecording()
            ACTION_RESUME -> resumeRecording()
            ACTION_KEEP_ALIVE_START -> startKeepAlive()
            ACTION_KEEP_ALIVE_STOP -> stopKeepAlive()
            ACTION_START_FILE_RECORDING -> {
                val filePath = intent.getStringExtra(EXTRA_FILE_PATH)
                if (filePath != null) {
                    startFileRecording(filePath)
                }
            }
            ACTION_STOP_FILE_RECORDING -> stopFileRecording()
        }

        // NOT_STICKY: a system restart would deliver a null intent, matching
        // no action — the restarted service would idle as a zombie with all
        // recording state (open WAV stream, file path) already gone.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.d(TAG, "Service destroyed")
        unregisterAudioDeviceCallback()
        stopRecording()
        releaseWakeLock()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ScribeMD Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when ScribeMD is recording audio"
                setShowBadge(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        // Create intent to open the app when notification is tapped
        val packageManager = applicationContext.packageManager
        val launchIntent = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ScribeMD Recording")
            .setContentText("Recording in progress...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "ScribeMD::MicrophoneStreamWakeLock"
            )
        }
        wakeLock?.acquire(60 * 60 * 1000L) // 1 hour max
        Log.d(TAG, "Wake lock acquired")
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "Wake lock released")
            }
        }
        wakeLock = null
    }

    private fun startRecording() {
        if (isStreaming && !isPaused) {
            Log.w(TAG, "Already recording")
            onError?.invoke("Audio streaming is already active")
            return
        }

        try {
            // Start foreground service with notification
            startForeground(NOTIFICATION_ID, createNotification())
            acquireWakeLock()
            isRunning = true

            // Initialize AudioRecord if needed
            if (audioRecord == null) {
                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    channelConfig,
                    audioFormat,
                    bufferSize
                )

                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    onError?.invoke("Failed to initialize AudioRecord")
                    audioRecord?.release()
                    audioRecord = null
                    stopSelf()
                    return
                }

                // Set preferred device if specified (API 23+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    preferredDeviceId?.let { deviceId ->
                        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                        val device = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                            .find { it.id == deviceId }
                        device?.let { audioRecord?.setPreferredDevice(it) }
                    }
                }
            }

            // Start recording
            audioRecord?.startRecording()
            isStreaming = true
            isPaused = false

            onStateChange?.invoke("streaming")
            Log.d(TAG, "Recording started")

            // Start reading audio data
            recordingJob = recordingScope.launch {
                val buffer = ByteArray(bufferSize)

                while (isActive && isStreaming) {
                    if (!isPaused && audioRecord != null) {
                        val bytesRead = audioRecord?.read(buffer, 0, buffer.size) ?: 0

                        if (bytesRead > 0) {
                            // Send PCM data to JS for real-time processing
                            val base64Data = Base64.encodeToString(buffer, 0, bytesRead, Base64.NO_WRAP)
                            onAudioData?.invoke(base64Data)

                            val audioLevel = calculateAudioLevel(buffer, bytesRead)
                            onAudioLevel?.invoke(audioLevel)

                            // Also write to WAV file if file recording is active
                            if (isFileRecording) {
                                writeAudioDataToFile(buffer, bytesRead)
                            }
                        } else if (bytesRead < 0) {
                            onError?.invoke("Error reading audio data: $bytesRead")
                            break
                        }
                    } else {
                        delay(100)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error starting recording", e)
            onError?.invoke("Failed to start audio streaming: ${e.message}")
            stopRecording()
        }
    }

    private fun stopRecording() {
        Log.d(TAG, "Stopping recording")
        isStreaming = false
        isPaused = false
        isRunning = false
        isKeepAliveMode = false

        recordingJob?.cancel()
        recordingJob = null

        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping audio record", e)
        }

        releaseWakeLock()
        onStateChange?.invoke("stopped")

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun pauseRecording() {
        // Only flip isPaused: the reader coroutine's loop condition is
        // `isActive && isStreaming`, so clearing isStreaming here would make
        // the loop exit permanently and resume would never produce audio
        // again (the coroutine is only launched by startRecording).
        isPaused = true
        onStateChange?.invoke("paused")
        Log.d(TAG, "Recording paused")
    }

    private fun resumeRecording() {
        isPaused = false
        onStateChange?.invoke("streaming")
        Log.d(TAG, "Recording resumed")
    }

    private fun startKeepAlive() {
        if (isRunning) {
            Log.w(TAG, "Service already running (recording or keep-alive)")
            return
        }

        try {
            // Start foreground service with notification but NO audio recording
            startForeground(NOTIFICATION_ID, createKeepAliveNotification())
            acquireWakeLock()
            isRunning = true
            isKeepAliveMode = true
            Log.d(TAG, "Keep-alive mode started (no audio recording)")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting keep-alive mode", e)
        }
    }

    private fun stopKeepAlive() {
        if (!isKeepAliveMode) {
            Log.w(TAG, "Not in keep-alive mode")
            return
        }

        Log.d(TAG, "Stopping keep-alive mode")
        isRunning = false
        isKeepAliveMode = false

        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createKeepAliveNotification(): Notification {
        // Create intent to open the app when notification is tapped
        val packageManager = applicationContext.packageManager
        val launchIntent = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ScribeMD Visit Mode")
            .setContentText("Visit recording active...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun calculateAudioLevel(buffer: ByteArray, bytesRead: Int): Double {
        if (bytesRead == 0) return smoothedAudioLevel

        var sum = 0.0
        val samples = bytesRead / 2

        val byteBuffer = ByteBuffer.wrap(buffer, 0, bytesRead)
        byteBuffer.order(ByteOrder.LITTLE_ENDIAN)
        val shortBuffer = byteBuffer.asShortBuffer()

        for (i in 0 until samples) {
            val sample = shortBuffer[i].toDouble() / Short.MAX_VALUE
            sum += sample * sample
        }

        val rms = kotlin.math.sqrt(sum / samples)

        // Convert to dB scale (-60 to 0) and normalize to 0-1
        val db = 20 * kotlin.math.log10(maxOf(rms, 0.000001))
        val normalizedDb = maxOf(0.0, minOf(1.0, (db + 60) / 60))

        // Apply EMA smoothing for smoother visualization
        smoothedAudioLevel = smoothingAlpha * normalizedDb + (1 - smoothingAlpha) * smoothedAudioLevel

        return smoothedAudioLevel
    }

    private fun updatePreferredDevice() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioRecord != null) {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val device = preferredDeviceId?.let { id ->
                audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).find { it.id == id }
            }
            audioRecord?.setPreferredDevice(device)
        }
    }

    private fun registerAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioDeviceCallback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                    onAudioRouteChange?.invoke()
                }
                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                    onAudioRouteChange?.invoke()
                }
            }
            audioManager.registerAudioDeviceCallback(audioDeviceCallback, null)
        }
    }

    private fun unregisterAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audioDeviceCallback?.let {
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.unregisterAudioDeviceCallback(it)
            }
            audioDeviceCallback = null
        }
    }

    // ==================== WAV File Recording ====================

    private fun startFileRecording(filePath: String) {
        if (isFileRecording) {
            Log.w(TAG, "File recording already in progress")
            return
        }

        try {
            // Handle file:// URI prefix
            var actualPath = if (filePath.startsWith("file://")) {
                filePath.removePrefix("file://")
            } else {
                filePath
            }

            // Ensure .wav extension
            if (!actualPath.lowercase().endsWith(".wav")) {
                actualPath = actualPath.substringBeforeLast(".") + ".wav"
            }

            currentFilePath = actualPath
            Log.d(TAG, "Starting WAV file recording to: $actualPath")

            // Create parent directory if needed
            val file = File(actualPath)
            file.parentFile?.mkdirs()

            // Delete existing file if any
            if (file.exists()) {
                file.delete()
            }

            // Open file and write placeholder WAV header (will be updated on stop)
            wavOutputStream = FileOutputStream(file)
            writeWavHeader(wavOutputStream!!, 0) // Placeholder header with 0 data size
            totalAudioBytes = 0

            isFileRecording = true
            Log.d(TAG, "WAV file recording started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting file recording", e)
            onError?.invoke("Failed to start file recording: ${e.message}")
            cleanupWavFile()
        }
    }

    private fun stopFileRecording() {
        if (!isFileRecording) {
            Log.w(TAG, "No file recording in progress")
            return
        }

        Log.d(TAG, "Stopping WAV file recording, total bytes: $totalAudioBytes")

        try {
            // Close the output stream
            wavOutputStream?.close()
            wavOutputStream = null

            // Update WAV header with actual data size
            currentFilePath?.let { path ->
                updateWavHeader(path, totalAudioBytes)

                val file = File(path)
                Log.d(TAG, "WAV file recording completed: $path, size: ${file.length()} bytes")

                // Store the path with file:// prefix for expo-file-system compatibility
                val fileUri = "file://$path"
                lastCompletedFilePath = fileUri

                onFileRecordingComplete?.invoke(fileUri)
            }

            isFileRecording = false
            currentFilePath = null
            totalAudioBytes = 0
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping file recording", e)
            onError?.invoke("Failed to stop file recording: ${e.message}")
            cleanupWavFile()
        }
    }

    private fun writeAudioDataToFile(buffer: ByteArray, bytesRead: Int) {
        if (!isFileRecording || wavOutputStream == null) return

        try {
            wavOutputStream?.write(buffer, 0, bytesRead)
            totalAudioBytes += bytesRead
        } catch (e: Exception) {
            Log.e(TAG, "Error writing audio data to file", e)
        }
    }

    private fun writeWavHeader(outputStream: FileOutputStream, dataSize: Long) {
        val channels = 1
        val bitsPerSample = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8

        val header = ByteBuffer.allocate(44)
        header.order(ByteOrder.LITTLE_ENDIAN)

        // RIFF header
        header.put("RIFF".toByteArray())
        header.putInt((36 + dataSize).toInt()) // File size - 8
        header.put("WAVE".toByteArray())

        // fmt chunk
        header.put("fmt ".toByteArray())
        header.putInt(16) // Subchunk1Size (16 for PCM)
        header.putShort(1) // AudioFormat (1 = PCM)
        header.putShort(channels.toShort()) // NumChannels
        header.putInt(sampleRate) // SampleRate
        header.putInt(byteRate) // ByteRate
        header.putShort(blockAlign.toShort()) // BlockAlign
        header.putShort(bitsPerSample.toShort()) // BitsPerSample

        // data chunk
        header.put("data".toByteArray())
        header.putInt(dataSize.toInt()) // Subchunk2Size

        outputStream.write(header.array())
    }

    private fun updateWavHeader(filePath: String, dataSize: Long) {
        try {
            RandomAccessFile(filePath, "rw").use { file ->
                // Update file size at offset 4 (RIFF chunk size)
                file.seek(4)
                file.write(intToLittleEndianBytes((36 + dataSize).toInt()))

                // Update data size at offset 40 (data chunk size)
                file.seek(40)
                file.write(intToLittleEndianBytes(dataSize.toInt()))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error updating WAV header", e)
        }
    }

    private fun intToLittleEndianBytes(value: Int): ByteArray {
        return byteArrayOf(
            (value and 0xFF).toByte(),
            ((value shr 8) and 0xFF).toByte(),
            ((value shr 16) and 0xFF).toByte(),
            ((value shr 24) and 0xFF).toByte()
        )
    }

    private fun cleanupWavFile() {
        try {
            wavOutputStream?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing WAV output stream", e)
        }
        wavOutputStream = null
        isFileRecording = false
        currentFilePath = null
        totalAudioBytes = 0
    }
}
