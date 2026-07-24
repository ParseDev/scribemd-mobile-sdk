import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { palette, radii, spacing, useTheme, withAlpha } from './theme';

/**
 * Boot placeholder for the pre-recording screen: mirrors the real idle
 * layout (toggle, template row, context box, record halo) so the reveal is
 * a fade-in of content, not a layout shift. Shown while the provider
 * finishes the token exchange + user-config fetch.
 */
export function IdleSkeleton(): React.ReactElement {
  const theme = useTheme();
  const shimmer = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.35, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.toggle, { opacity: shimmer }]} />
      <Animated.View style={[styles.row, { opacity: shimmer }]} />
      <Animated.View style={[styles.label, { opacity: shimmer }]} />
      <Animated.View style={[styles.box, { opacity: shimmer }]} />
      <View style={styles.centered}>
        <Animated.View
          style={[
            styles.recordHalo,
            { backgroundColor: withAlpha(theme.accent, 0.08), opacity: shimmer },
          ]}>
          <View style={[styles.recordCore, { backgroundColor: withAlpha(theme.accent, 0.25) }]} />
        </Animated.View>
        <Animated.View style={[styles.hint, { opacity: shimmer }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.md,
  },
  toggle: {
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceMuted,
  },
  row: {
    height: 48,
    borderRadius: 12,
    backgroundColor: palette.surfaceMuted,
  },
  label: {
    width: 110,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.surfaceMuted,
  },
  box: {
    height: 96,
    borderRadius: 12,
    backgroundColor: palette.surfaceMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  recordHalo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCore: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  hint: {
    width: 190,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.surfaceMuted,
  },
});
