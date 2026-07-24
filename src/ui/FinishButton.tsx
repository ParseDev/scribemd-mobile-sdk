import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cardShadow, palette, radii, useTheme } from './theme';
import { strings } from '../strings';

export interface FinishButtonProps {
  onPress: () => void;
  disabled?: boolean;
  /** Overrides the "Stop" label. */
  label?: string;
  /** Button background (default: near-black ink). */
  color?: string;
  /** Label color (default: white). */
  textColor?: string;
}

/**
 * Plain tap-to-finish button — the alternative to SlideToFinish for hosts
 * that prefer a conventional control (finishControl={{ variant: 'button' }}).
 */
export function FinishButton({
  onPress,
  disabled = false,
  label,
  color,
  textColor,
}: FinishButtonProps): React.ReactElement {
  const themePalette = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? strings.stop}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: color ?? themePalette.stop },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <View style={[styles.glyph, { backgroundColor: textColor ?? palette.onStop }]} />
      <Text style={[styles.label, { color: textColor ?? palette.onStop }]}>
        {label ?? strings.stop}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 60,
    borderRadius: radii.pill,
    ...cardShadow,
    shadowOpacity: 0.12,
  },
  glyph: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.4,
  },
});
