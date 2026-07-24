import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { TablerIcon } from './icons';
import { radii, useTheme, withAlpha } from './theme';
import { isRtlLanguage, strings } from '../strings';

const TRACK_HEIGHT = 60;
const TRACK_PADDING = 4;
const THUMB_SIZE = TRACK_HEIGHT - TRACK_PADDING * 2;
/** Fraction of the travel that counts as a completed slide. */
const COMPLETE_THRESHOLD = 0.8;

export interface SlideToFinishProps {
  onComplete: () => void;
  disabled?: boolean;
  language?: string;
  /** Overrides the "Slide to finish" label. */
  label?: string;
  /** Track/fill tint (default: the theme accent). */
  color?: string;
  /** Label color. */
  textColor?: string;
}

/**
 * Slide-to-finish control — app parity: accent-tinted track, a fill that
 * follows the thumb, and a white thumb with an arrow.
 */
export function SlideToFinish({
  onComplete,
  disabled = false,
  language,
  label,
  color,
  textColor,
}: SlideToFinishProps): React.ReactElement {
  const themePalette = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const trackWidthRef = useRef(0);
  trackWidthRef.current = trackWidth;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completedRef = useRef(false);

  const rtl = isRtlLanguage(language);
  const tint = color ?? themePalette.accent;

  const maxTravel = () => Math.max(0, trackWidthRef.current - THUMB_SIZE - TRACK_PADDING * 2);

  const springBack = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current && !completedRef.current,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !disabledRef.current && !completedRef.current && Math.abs(gesture.dx) > 4,
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(Math.min(Math.max(0, gesture.dx), maxTravel()));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx >= maxTravel() * COMPLETE_THRESHOLD && maxTravel() > 0) {
          completedRef.current = true;
          Animated.timing(translateX, {
            toValue: maxTravel(),
            duration: 120,
            useNativeDriver: false,
          }).start(() => onCompleteRef.current());
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  // The fill trails the thumb (app parity): width = thumb position + thumb.
  const fillWidth = Animated.add(translateX, new Animated.Value(THUMB_SIZE + TRACK_PADDING * 2));
  // Label fades out as the thumb approaches halfway.
  const labelOpacity =
    trackWidth > 0
      ? translateX.interpolate({
          inputRange: [0, Math.max(1, maxTravel() * 0.5)],
          outputRange: [1, 0],
          extrapolate: 'clamp',
        })
      : 1;

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: withAlpha(tint, 0.13) },
        disabled && styles.disabled,
      ]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label ?? strings.slideToFinish}
      accessibilityHint={strings.stop}>
      <Animated.View
        style={[styles.fill, { backgroundColor: withAlpha(tint, 0.3), width: fillWidth }]}
      />
      <Animated.View style={[styles.labelContainer, { opacity: labelOpacity }]} pointerEvents="none">
        <Text style={[styles.label, { color: textColor ?? tint }]}>
          {label ?? strings.slideToFinish}
        </Text>
        <Text style={[styles.arrow, { color: textColor ?? tint }]}>{rtl ? '←' : '→'}</Text>
      </Animated.View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.thumb, { transform: [{ translateX }] }]}>
        <TablerIcon name="chevron" size={18} color={tint} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flex: 1,
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    justifyContent: 'center',
    padding: TRACK_PADDING,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    borderRadius: radii.pill,
  },
  labelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  arrow: {
    fontSize: 16,
    fontWeight: '700',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  disabled: {
    opacity: 0.5,
  },
});
