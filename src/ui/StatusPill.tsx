import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { cardShadow, palette, radii, useTheme, type ScribePalette } from './theme';
import { strings } from '../strings';

export type SessionStatus =
  'connecting' | 'listening' | 'paused' | 'reconnecting' | 'finalizing' | 'generating';

// Dot colors are palette KEYS so the per-session theme resolves at render.
const STATUS_CONFIG: Record<
  SessionStatus,
  { label: () => string; dot: keyof ScribePalette; pulses: boolean }
> = {
  connecting: { label: () => strings.statusConnecting, dot: 'textMuted', pulses: true },
  listening: { label: () => strings.statusListening, dot: 'accent', pulses: true },
  paused: { label: () => strings.statusPaused, dot: 'textMuted', pulses: false },
  reconnecting: { label: () => strings.statusReconnecting, dot: 'textSecondary', pulses: true },
  finalizing: { label: () => strings.statusFinalizing, dot: 'accent', pulses: true },
  generating: { label: () => strings.statusGenerating, dot: 'accent', pulses: true },
};

export interface StatusPillProps {
  status: SessionStatus;
}

export function StatusPill({ status }: StatusPillProps): React.ReactElement {
  const config = STATUS_CONFIG[status];
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!config.pulses) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [config.pulses, pulse]);

  return (
    <View
      style={[styles.pill, { backgroundColor: theme.surface }]}
      accessibilityRole="text"
      accessibilityLabel={config.label()}>
      <Animated.View style={[styles.dot, { backgroundColor: theme[config.dot], opacity: pulse }]} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{config.label()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    ...cardShadow,
    shadowOpacity: 0.04,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
