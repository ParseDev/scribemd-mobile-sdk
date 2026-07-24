import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from './theme';

export interface WaveformProps {
  /** Rolling window of normalized audio levels (0–1), oldest first. */
  levels: number[];
  paused?: boolean;
  /** Bar area height in px. Default 96. */
  height?: number;
}

const MIN_BAR_HEIGHT = 4;

/**
 * Animated level bars driven directly by microphone audio frames.
 * Levels arrive ~10–20x/sec, so plain re-renders read as animation.
 */
export function Waveform({
  levels,
  paused = false,
  height = 96,
}: WaveformProps): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.row, { height }]} pointerEvents="none">
      {levels.map((level, index) => {
        // Perceptual scaling: quiet speech still moves the bars.
        const scaled = Math.pow(Math.min(Math.max(level, 0), 1), 0.5);
        const barHeight = Math.max(MIN_BAR_HEIGHT, scaled * height);
        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height: barHeight,
                backgroundColor: paused ? theme.textMuted : theme.accent,
                opacity: paused ? 0.35 + scaled * 0.25 : 0.4 + scaled * 0.6,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 4,
  },
  bar: {
    flex: 1,
    borderRadius: 999,
  },
});
