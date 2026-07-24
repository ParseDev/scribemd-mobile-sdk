import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TablerIcon } from './icons';
import { cardShadow, palette, radii, spacing, useTheme } from './theme';
import { isRtlLanguage, strings } from '../strings';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ContextInputProps {
  value: string;
  onChange: (text: string) => void;
  language?: string;
  disabled?: boolean;
  /**
   * Live-session variant: a compact chip that opens a bottom-sheet editor —
   * keeps the recording screen light while the clinician can still add
   * context mid-visit (app parity).
   */
  collapsible?: boolean;
}

/**
 * Free-text "Add context" field (app parity: EncounterDetails' context
 * notes, stored server-side as current_notes_text).
 */
export function ContextInput({
  value,
  onChange,
  language,
  disabled = false,
  collapsible = false,
}: ContextInputProps): React.ReactElement {
  const rtl = isRtlLanguage(language);
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const openSheet = useCallback(() => {
    setOpen(true);
    Animated.timing(sheetAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetAnim]);

  const closeSheet = useCallback(() => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setOpen(false));
  }, [sheetAnim]);

  if (collapsible) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.addContext}
          onPress={openSheet}
          disabled={disabled}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: theme.surface },
            rtl && styles.rowRtl,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}>
          <TablerIcon name="writing" size={16} color={theme.accent} />
          <Text
            style={[
              styles.chipText,
              { color: value ? theme.textPrimary : theme.textSecondary },
              rtl && styles.textRtl,
            ]}
            numberOfLines={1}>
            {value || strings.addContext}
          </Text>
        </Pressable>

        <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
          <View style={styles.overlayRoot}>
            <AnimatedPressable
              style={[styles.backdrop, { opacity: sheetAnim }]}
              onPress={closeSheet}
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              pointerEvents="box-none"
              style={styles.sheetContainer}>
              <AnimatedPressable
                onPress={() => {}}
                style={[
                  styles.sheet,
                  { backgroundColor: theme.surface },
                  {
                    transform: [
                      {
                        translateY: sheetAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [420, 0],
                        }),
                      },
                    ],
                  },
                ]}>
                <View style={styles.grabber} />
                <View style={[styles.sheetHeader, rtl && styles.rowRtl]}>
                  <View style={[styles.sheetTitleGroup, rtl && styles.rowRtl]}>
                    <TablerIcon name="writing" size={20} color={theme.textSecondary} />
                    <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>
                      {strings.addContext}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.done}
                    onPress={closeSheet}
                    hitSlop={10}
                    style={({ pressed }) => [pressed && styles.pressed]}>
                    <Text style={[styles.doneLabel, { color: theme.accent }]}>{strings.done}</Text>
                  </Pressable>
                </View>
                <TextInput
                  style={[
                    styles.sheetInput,
                    { color: theme.textPrimary },
                    rtl && styles.textRtl,
                  ]}
                  value={value}
                  onChangeText={onChange}
                  placeholder={strings.addContextPlaceholder}
                  placeholderTextColor={theme.textMuted}
                  multiline
                  autoFocus
                  textAlignVertical="top"
                  accessibilityLabel={strings.addContext}
                />
              </AnimatedPressable>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.labelRow, rtl && styles.rowRtl]}>
        <View style={[styles.labelGroup, rtl && styles.rowRtl]}>
          <TablerIcon name="writing" size={20} color={theme.textSecondary} />
          <Text style={[styles.label, { color: theme.textPrimary }]}>{strings.addContext}</Text>
        </View>
        {value.length > 0 && (
          <Text style={[styles.count, { color: theme.textMuted }]}>{value.length}</Text>
        )}
      </View>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: theme.surfaceMuted, color: theme.textPrimary },
          rtl && styles.textRtl,
          disabled && styles.disabled,
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={strings.addContextPlaceholder}
        placeholderTextColor={theme.textMuted}
        multiline
        editable={!disabled}
        textAlignVertical="top"
        accessibilityLabel={strings.addContext}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    ...cardShadow,
    shadowOpacity: 0.04,
  },
  chipText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  count: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  // App parity: muted surface, border, rounded-xl, roomy textarea.
  input: {
    minHeight: 96,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    lineHeight: 21,
    color: palette.textPrimary,
  },
  overlayRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheetContainer: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  doneLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  sheetInput: {
    minHeight: 140,
    maxHeight: 260,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    lineHeight: 21,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
