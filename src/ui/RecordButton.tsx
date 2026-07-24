import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';

import { useTheme, withAlpha } from './theme';
import { strings } from '../strings';

export type RecordButtonState = 'idle' | 'busy' | 'recording';

export interface RecordButtonProps {
  state: RecordButtonState;
  onPress: () => void;
  disabled?: boolean;
}

const BUTTON_SIZE = 84;
/** Static "listening halo" rings around the button — the SDK's signature. */
const HALO_INNER = 116;
const HALO_OUTER = 148;

/** Circular record button inside a soft accent halo; pulses while recording. */
export function RecordButton({
  state,
  onPress,
  disabled = false,
}: RecordButtonProps): React.ReactElement {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'recording') {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  // Idle: the outer halo breathes slowly — a calm "ready to listen" cue.
  useEffect(() => {
    if (state !== 'idle' || disabled) {
      breathe.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.07, duration: 1600, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [state, disabled, breathe]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.halo,
          {
            width: HALO_OUTER,
            height: HALO_OUTER,
            borderRadius: HALO_OUTER / 2,
            backgroundColor: withAlpha(theme.accent, 0.06),
            transform: [{ scale: breathe }],
          },
        ]}
        pointerEvents="none"
      />
      <View
        style={[styles.halo, { width: HALO_INNER, height: HALO_INNER, borderRadius: HALO_INNER / 2, backgroundColor: withAlpha(theme.accent, 0.1) }]}
        pointerEvents="none"
      />
      {state === 'recording' && (
        <Animated.View
          style={[
            styles.pulseRing,
            { backgroundColor: theme.accent },
            { transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.startRecording}
        onPress={onPress}
        disabled={disabled || state === 'busy'}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.accent, shadowColor: theme.accent },
          pressed && styles.buttonPressed,
          disabled && styles.buttonDisabled,
        ]}>
        {state === 'busy' ? (
          <ActivityIndicator color={theme.onAccent} />
        ) : state === 'recording' ? (
          <View style={[styles.recordingGlyph, { backgroundColor: theme.onAccent }]} />
        ) : (
          <View style={[styles.idleGlyph, { borderColor: withAlpha(theme.onAccent, 0.9) }]}>
            <View style={[styles.idleGlyphDot, { backgroundColor: theme.onAccent }]} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: HALO_OUTER,
    height: HALO_OUTER,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  // Theme-dependent colors (accent, onAccent) are applied inline at render.
  halo: {
    position: 'absolute',
  },
  pulseRing: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  // Idle: ring + center dot reads as a quiet "ready" target.
  idleGlyph: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleGlyphDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  recordingGlyph: {
    width: 24,
    height: 24,
    borderRadius: 7,
  },
});
