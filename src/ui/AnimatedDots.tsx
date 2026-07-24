import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useTheme } from './theme';

const DOT_COUNT = 3;
const STEP_MS = 160;
const FADE_MS = 320;

export interface AnimatedDotsProps {
  /** Defaults to the theme accent. */
  color?: string;
}

/** Three staggered pulsing dots — subtle progress cue without a spinner. */
export function AnimatedDots({ color }: AnimatedDotsProps): React.ReactElement {
  const theme = useTheme();
  const values = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.25))
  ).current;

  useEffect(() => {
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * STEP_MS),
          Animated.timing(value, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.25, duration: FADE_MS, useNativeDriver: true }),
          // Pad every cycle to the same length so the stagger never drifts.
          Animated.delay((DOT_COUNT - 1 - index) * STEP_MS),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [values]);

  const dotColor = color ?? theme.accent;
  return (
    <View style={styles.row} pointerEvents="none">
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: dotColor, opacity: value }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
