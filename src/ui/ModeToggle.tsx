import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cardShadow, palette, radii, useTheme } from './theme';
import { strings } from '../strings';
import type { EncounterMode } from '../api/encounters';

export interface ModeToggleProps {
  mode: EncounterMode;
  onChange: (mode: EncounterMode) => void;
  disabled?: boolean;
}

/**
 * Two-segment visit/dictation pill, shown pre-recording only (like the
 * app's ModeToggle, gated by the user's `encounter_modes` setting).
 */
export function ModeToggle({ mode, onChange, disabled = false }: ModeToggleProps): React.ReactElement {
  const themePalette = useTheme();

  const segment = (value: EncounterMode, label: string) => {
    const selected = mode === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        onPress={() => onChange(value)}
        disabled={disabled || selected}
        style={({ pressed }) => [
          styles.segment,
          selected && { backgroundColor: themePalette.accent },
          pressed && styles.pressed,
        ]}>
        <Text
          style={[
            styles.label,
            { color: selected ? palette.onAccent : themePalette.textSecondary },
          ]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.track, { backgroundColor: themePalette.surface }, disabled && styles.disabled]}>
      {segment('visit', strings.modeVisit)}
      {segment('dictation', strings.modeDictate)}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.pill,
    padding: 3,
    gap: 3,
    ...cardShadow,
    shadowOpacity: 0.04,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.4,
  },
});
