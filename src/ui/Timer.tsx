import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { palette, useTheme } from './theme';

export interface TimerProps {
  seconds: number;
  /** Recording (not paused): red pulsing dot; otherwise a static gray dot. */
  running?: boolean;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Compact session timer with a recording dot (app parity: EncounterDetails'
 * timer row — semibold digits, red pulse while capturing).
 */
export function Timer({ seconds, running = false }: TimerProps): React.ReactElement {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!running) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [running, pulse]);

  return (
    <View style={styles.row} accessibilityRole="text">
      <Text style={[styles.timer, { color: running ? theme.textPrimary : theme.textSecondary }]}>
        {formatDuration(seconds)}
      </Text>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: running ? RECORDING_RED : theme.textMuted,
            transform: [{ scale: pulse }],
          },
        ]}
      />
    </View>
  );
}

/** App parity: the recording dot is red (bg-red-500), not the accent. */
const RECORDING_RED = '#EF4444';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timer: {
    fontSize: 26,
    fontWeight: '600',
    color: palette.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
