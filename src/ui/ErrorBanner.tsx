import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radii, spacing } from './theme';
import { strings } from '../strings';

export interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

/**
 * Dismissable inline error for transient failures (WebSocket drop, note
 * generation) that must NOT tear down the session UI or its transcript.
 */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps): React.ReactElement {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.dismiss}
        onPress={onDismiss}
        hitSlop={8}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}>
        <Text style={styles.dismissGlyph}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: palette.dangerBorder,
    backgroundColor: palette.dangerSoft,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: palette.danger,
  },
  dismiss: {
    padding: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  dismissGlyph: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.danger,
  },
});
