import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FinishButton } from './FinishButton';
import { TablerIcon } from './icons';
import { SlideToFinish } from './SlideToFinish';
import { palette, radii, useTheme } from './theme';
import { strings } from '../strings';

/**
 * Host customization of the finish control (web-widget-style knobs):
 * slider (default, deliberate drag) or a plain button, with optional label
 * and color overrides.
 */
export interface FinishControlConfig {
  /** 'slide' (default): drag to finish. 'button': plain tap. */
  variant?: 'slide' | 'button';
  /** Overrides "Slide to finish" / "Stop". */
  label?: string;
  /** Tint (slide track/fill) or button background color. */
  color?: string;
  /** Label color. */
  textColor?: string;
}

export interface ControlsProps {
  paused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
  disabled?: boolean;
  language?: string;
  finishControl?: FinishControlConfig;
}

/**
 * App-parity controls row: a dark pause/resume pill with a text label next
 * to the finish action (slide by default; plain button when the host asks).
 */
export function Controls({
  paused,
  onPauseResume,
  onStop,
  disabled = false,
  language,
  finishControl,
}: ControlsProps): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paused ? strings.resume : strings.pause}
        onPress={onPauseResume}
        disabled={disabled}
        style={({ pressed }) => [
          styles.pausePill,
          { backgroundColor: theme.stop },
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}>
        <TablerIcon name={paused ? 'play' : 'pause'} size={17} color={palette.onStop} />
        <Text style={styles.pauseLabel}>{paused ? strings.resume : strings.pause}</Text>
      </Pressable>

      {finishControl?.variant === 'button' ? (
        <FinishButton
          onPress={onStop}
          disabled={disabled}
          label={finishControl.label}
          color={finishControl.color}
          textColor={finishControl.textColor}
        />
      ) : (
        <SlideToFinish
          onComplete={onStop}
          disabled={disabled}
          language={language}
          label={finishControl?.label}
          color={finishControl?.color}
          textColor={finishControl?.textColor}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pausePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 60,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
  },
  pauseLabel: {
    color: palette.onStop,
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
