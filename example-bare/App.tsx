/**
 * ScribeMD bare React Native example.
 *
 * Mirrors the web widget's demo page: authentication, patient context,
 * session options (language, template restriction, consultation context,
 * auto-start), then a full-screen scribe session.
 */
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ScribeMDProvider,
  ScribeSession,
  type ScribeSessionHandle,
} from '@scribemd-ai/mobile-sdk';

// ScribeMD app identity: primary blue (see scribemd-mobile tailwind theme).
const ACCENT = '#1e40af';

interface SessionResult {
  note: string | null;
  transcript: string;
  encounterId?: string;
}

function App(): React.JSX.Element {
  // Authentication
  const [sessionToken, setSessionToken] = useState('');
  const [apiToken, setApiToken] = useState('');
  // Patient context
  const [patientId, setPatientId] = useState('');
  const [medicalRecord, setMedicalRecord] = useState('');
  const [timestamp, setTimestamp] = useState('');
  // Session options (web-widget parity)
  const [language, setLanguage] = useState<'en' | 'he' | 'ar' | 'fr' | 'es'>('en');
  const [mode, setMode] = useState<'default' | 'visit' | 'dictation'>('default');
  const [templateId, setTemplateId] = useState('');
  const [templateLocked, setTemplateLocked] = useState(false);
  const [context, setContext] = useState('');
  const [autoStart, setAutoStart] = useState(false);
  // Finish-control customization (web-widget-style knobs)
  const [finishVariant, setFinishVariant] = useState<'slide' | 'button'>('slide');
  const [finishLabel, setFinishLabel] = useState('');
  const [finishColor, setFinishColor] = useState('');
  // Theme customization
  const [accentColor, setAccentColor] = useState(ACCENT);
  const [stopColor, setStopColor] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  // Host-managed close: the header "Close" routes through the SDK's
  // confirmation/discard logic via this ref.
  const sessionRef = useRef<ScribeSessionHandle>(null);

  const canStart = sessionToken.trim().length > 0 || apiToken.trim().length > 0;

  if (running) {
    const auth = sessionToken.trim()
      ? { sessionToken: sessionToken.trim() }
      : { apiToken: apiToken.trim() };

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        {/* Everything outside the framed area below is HOST app UI. */}
        <View style={styles.hostBar}>
          <Text style={styles.hostBarText}>Host app — example screen</Text>
          {/* Host-owned close, SDK-owned logic: confirmations + discard. */}
          <TouchableOpacity onPress={() => sessionRef.current?.requestClose()} hitSlop={12}>
            <Text style={styles.hostBarClose}>Close</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.sdkFrame}>
          <View style={styles.sdkTag}>
            <Text style={styles.sdkTagText}>ScribeMD SDK</Text>
          </View>
          <ScribeMDProvider
        {...auth}
        language={language}
        onSessionRecovered={encounterId => {
          console.warn('[Example] recovered session finalized:', encounterId);
        }}>
        <ScribeSession
          ref={sessionRef}
          hideHeader
          patientContext={{
            patientId: patientId.trim() || undefined,
            medicalRecord: medicalRecord.trim() || undefined,
            timestamp: timestamp.trim() || undefined,
          }}
          initialMode={mode === 'default' ? undefined : mode}
          noteTemplateId={templateId.trim() || undefined}
          noteTemplateLocked={templateLocked && templateId.trim().length > 0}
          initialContext={context.trim() || undefined}
          autoStart={autoStart}
          theme={{
            accentColor,
            stopColor: stopColor.trim() || undefined,
            backgroundColor: backgroundColor.trim() || undefined,
          }}
          finishControl={{
            variant: finishVariant,
            label: finishLabel.trim() || undefined,
            color: finishColor.trim() || undefined,
          }}
          onComplete={sessionResult => {
            if (sessionResult.note) setLastError(null);
            setResult({
              note:
                sessionResult.note?.markdown ??
                sessionResult.note?.plain ??
                null,
              transcript: sessionResult.transcript,
              encounterId: sessionResult.encounterId,
            });
            setRunning(false);
          }}
          onError={error => {
            console.warn('[Example] session error:', error.message);
            setLastError(error.message);
          }}
          onCancel={() => setRunning(false)}
        />
          </ScribeMDProvider>
        </View>
      </SafeAreaView>
    );
  }

  if (result) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>
            {result.note ? 'Clinical note' : 'Transcript (no note generated)'}
          </Text>
          {result.encounterId != null && (
            <Text style={styles.subtitle}>Encounter #{result.encounterId}</Text>
          )}
          {lastError != null && <Text style={styles.errorText}>{lastError}</Text>}
          <Text style={styles.resultBody}>{result.note ?? result.transcript}</Text>
          {result.note != null && result.transcript.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Raw transcript</Text>
              <Text style={styles.resultTranscript}>{result.transcript}</Text>
            </>
          )}
          <TouchableOpacity style={styles.button} onPress={() => setResult(null)}>
            <Text style={styles.buttonText}>New session</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>ScribeMD SDK</Text>
          <Text style={styles.subtitle}>
            Configure the session like the web widget, then start scribing.
          </Text>

          <Section title="Authentication">
            <Field
              label="Session token (production)"
              value={sessionToken}
              onChange={setSessionToken}
              placeholder="session_token_…"
            />
            <Field
              label="API token (dev only)"
              value={apiToken}
              onChange={setApiToken}
              placeholder="access token"
              secure
            />
          </Section>

          <Section title="Patient context">
            <Field label="Patient ID" value={patientId} onChange={setPatientId} placeholder="e.g. 4482" />
            <Field
              label="Medical record"
              value={medicalRecord}
              onChange={setMedicalRecord}
              placeholder="MRN"
            />
            <Field
              label="Timestamp"
              value={timestamp}
              onChange={setTimestamp}
              placeholder="e.g. 2026-07-13T10:00:00Z"
            />
          </Section>

          <Section title="Session options">
            <Text style={styles.fieldLabel}>Language</Text>
            <View style={styles.segmentRow}>
              {(
                [
                  ['en', 'English'],
                  ['he', 'עברית'],
                  ['ar', 'العربية'],
                  ['fr', 'Français'],
                  ['es', 'Español'],
                ] as const
              ).map(([code, label]) => (
                <TouchableOpacity
                  key={code}
                  style={[styles.segment, language === code && styles.segmentActive]}
                  onPress={() => setLanguage(code)}>
                  <Text
                    style={[
                      styles.segmentLabel,
                      language === code && styles.segmentLabelActive,
                    ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Recording mode</Text>
            <View style={styles.segmentRow}>
              {(
                [
                  ['default', "User's default"],
                  ['visit', 'Visit'],
                  ['dictation', 'Dictation'],
                ] as const
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.segment, mode === value && styles.segmentActive]}
                  onPress={() => setMode(value)}>
                  <Text
                    style={[styles.segmentLabel, mode === value && styles.segmentLabelActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Field
              label="Restrict to note template ID (optional)"
              value={templateId}
              onChange={setTemplateId}
              placeholder="e.g. 1267 for a standard SOAP note"
              keyboardType="number-pad"
            />
            <ToggleRow
              label="Lock template (hide picker)"
              value={templateLocked}
              onChange={setTemplateLocked}
              disabled={templateId.trim().length === 0}
            />

            <Text style={styles.fieldLabel}>Consultation context</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={context}
              onChangeText={setContext}
              placeholder="e.g. Patient presents with chest pain for 2 days…"
              placeholderTextColor="#9aa4b0"
              multiline
              textAlignVertical="top"
            />
            <ToggleRow
              label="Auto-start recording"
              value={autoStart}
              onChange={setAutoStart}
            />
          </Section>

          <Section title="Theme">
            <SwatchRow
              label="Accent (primary)"
              value={accentColor}
              onChange={setAccentColor}
              swatches={['#1e40af', '#059669', '#0a7d62', '#7C3AED', '#DB2777', '#0F172A']}
            />
            <SwatchRow
              label="Buttons (stop/finish)"
              value={stopColor}
              onChange={setStopColor}
              swatches={['', '#0F172A', '#0a7d62', '#B91C1C', '#7C3AED']}
            />
            <SwatchRow
              label="Background"
              value={backgroundColor}
              onChange={setBackgroundColor}
              swatches={['', '#F8FAFC', '#FFFFFF', '#F0FDF4', '#FEFCE8', '#101828']}
            />
          </Section>

          <Section title="Finish control">
            <View style={styles.segmentRow}>
              {(
                [
                  ['slide', 'Slide to finish'],
                  ['button', 'Finalize button'],
                ] as const
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.segment, finishVariant === value && styles.segmentActive]}
                  onPress={() => setFinishVariant(value)}>
                  <Text
                    style={[
                      styles.segmentLabel,
                      finishVariant === value && styles.segmentLabelActive,
                    ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Field
              label="Custom label (optional)"
              value={finishLabel}
              onChange={setFinishLabel}
              placeholder={finishVariant === 'slide' ? 'Slide to finish' : 'Finalize'}
            />
            <Field
              label="Custom color (optional)"
              value={finishColor}
              onChange={setFinishColor}
              placeholder="#0F172A"
            />
          </Section>

          <TouchableOpacity
            style={[styles.button, !canStart && styles.buttonDisabled]}
            disabled={!canStart}
            onPress={() => {
              setLastError(null);
              setRunning(true);
            }}>
            <Text style={styles.buttonText}>Start scribe session</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa4b0"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function SwatchRow({
  label,
  value,
  onChange,
  swatches,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  swatches: string[];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.swatchRow}>
        {swatches.map(color => (
          <TouchableOpacity
            key={color || 'default'}
            onPress={() => onChange(color)}
            style={[
              styles.swatch,
              color
                ? { backgroundColor: color }
                : styles.swatchDefault,
              value === color && styles.swatchSelected,
            ]}>
            {!color && <Text style={styles.swatchDefaultLabel}>–</Text>}
          </TouchableOpacity>
        ))}
        <TextInput
          style={styles.swatchHexInput}
          value={value}
          onChangeText={onChange}
          placeholder="#hex"
          placeholderTextColor="#9aa4b0"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.dimmed]}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: ACCENT }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f8f9',
  },
  flex: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#101828',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#5f6b7a',
    marginBottom: 20,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6eaee',
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#101828',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#344054',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5dbe2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#101828',
    backgroundColor: '#fbfcfd',
  },
  multiline: {
    minHeight: 80,
    marginBottom: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d5dbe2',
    backgroundColor: '#fbfcfd',
  },
  segmentActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#344054',
  },
  segmentLabelActive: {
    color: '#ffffff',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#344054',
    flex: 1,
    marginRight: 12,
  },
  dimmed: {
    opacity: 0.4,
  },
  button: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultBody: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    color: '#101828',
  },
  resultTranscript: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5f6b7a',
    marginBottom: 24,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#b91c1c',
    marginBottom: 16,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#d5dbe2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDefault: {
    backgroundColor: '#fbfcfd',
  },
  swatchDefaultLabel: {
    fontSize: 14,
    color: '#9aa4b0',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#101828',
  },
  swatchHexInput: {
    flex: 1,
    minWidth: 80,
    borderWidth: 1,
    borderColor: '#d5dbe2',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: '#101828',
    backgroundColor: '#fbfcfd',
  },
  hostBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hostBarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5f6b7a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  hostBarClose: {
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  sdkFrame: {
    flex: 1,
    margin: 10,
    marginTop: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: ACCENT,
    borderRadius: 24,
    overflow: 'hidden',
  },
  sdkTag: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    zIndex: 1,
    backgroundColor: ACCENT,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  sdkTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.6,
  },
});

export default App;
