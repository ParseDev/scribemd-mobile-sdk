import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

import { TablerIcon } from './icons';
import { palette, radii, spacing, useTheme } from './theme';
import { isRtlLanguage, strings } from '../strings';
import type { NoteTemplateSummary } from '../api/userData';

export interface TemplatePickerProps {
  templates: NoteTemplateSummary[];
  /** Selected template id; '' = server default. */
  selectedId: string;
  onSelect: (templateId: string) => void;
  language?: string;
  disabled?: boolean;
  /** Live-screen chip: icon + selected name only, no "Template" label. */
  compact?: boolean;
}

/**
 * Template row + bottom-sheet picker (plain RN Modal — mirrors the app's
 * TemplatePicker without a gesture-sheet dependency). '' means "no explicit
 * choice": the backend falls back to the user/organization default.
 */
export function TemplatePicker({
  templates,
  selectedId,
  onSelect,
  language,
  disabled = false,
  compact = false,
}: TemplatePickerProps): React.ReactElement {
  const themePalette = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rtl = isRtlLanguage(language);
  const rowDirection = rtl ? styles.rowRtl : null;
  const textAlign = rtl ? styles.textRtl : null;

  const selectedName =
    templates.find((template) => template.id === selectedId)?.name ?? strings.chooseTemplate;

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((template) => template.name.toLowerCase().includes(needle));
  }, [templates, query]);

  const showSearch = templates.length > 6;

  // Custom open/close animation: the backdrop FADES while the sheet slides
  // up (Modal's own animationType slides the dark overlay with the sheet,
  // which looks broken).
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
    }).start(() => {
      setOpen(false);
      setQuery('');
    });
  }, [sheetAnim]);

  const choose = (templateId: string) => {
    closeSheet();
    if (templateId !== selectedId) onSelect(templateId);
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.selectTemplate}
        onPress={openSheet}
        disabled={disabled}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: themePalette.surfaceMuted },
          rowDirection,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}>
        <TablerIcon name="template" size={20} color={themePalette.textSecondary} />
        <Text
          style={[
            styles.rowValue,
            { color: selectedId !== '' ? themePalette.textPrimary : themePalette.textSecondary },
            textAlign,
          ]}
          numberOfLines={1}>
          {selectedName}
        </Text>
        {/* Chevron-down (app parity): the shared chevron asset, rotated. */}
        <View style={styles.chevronDown}>
          <TablerIcon name="chevron" size={16} color={themePalette.textSecondary} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <View style={styles.overlayRoot}>
          {/* Fading backdrop; tapping it closes. The sheet is a sibling on
              top and claims its own touches. */}
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
            { backgroundColor: themePalette.surface },
            {
              transform: [
                {
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [560, 0],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: themePalette.textPrimary }, textAlign]}>
              {strings.selectTemplate}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.cancel}
              onPress={closeSheet}
              hitSlop={10}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
              <TablerIcon name="x" size={16} color={themePalette.textSecondary} />
            </Pressable>
          </View>
          {showSearch && (
            <View style={[styles.searchBox, rtl && styles.rowRtl]}>
              <TablerIcon name="search" size={16} color={themePalette.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: themePalette.textPrimary }, rtl && styles.textRtl]}
                value={query}
                onChangeText={setQuery}
                placeholder={strings.searchTemplates}
                placeholderTextColor={themePalette.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={strings.searchTemplates}
              />
            </View>
          )}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled">
            {query.trim().length === 0 && (
              <TemplateOption
                label={strings.chooseTemplate}
                selected={selectedId === ''}
                accent={themePalette.accent}
                textColor={themePalette.textPrimary}
                rtl={rtl}
                onPress={() => choose('')}
              />
            )}
            {filteredTemplates.map((template) => (
              <TemplateOption
                key={template.id}
                label={template.name}
                selected={template.id === selectedId}
                accent={themePalette.accent}
                textColor={themePalette.textPrimary}
                rtl={rtl}
                onPress={() => choose(template.id)}
              />
            ))}
          </ScrollView>
        </AnimatedPressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function TemplateOption({
  label,
  selected,
  accent,
  textColor,
  rtl,
  onPress,
}: {
  label: string;
  selected: boolean;
  accent: string;
  textColor: string;
  rtl: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, rtl && styles.rowRtl, pressed && styles.pressed]}>
      <Text
        style={[styles.optionLabel, { color: selected ? accent : textColor }, rtl && styles.textRtl]}
        numberOfLines={1}>
        {label}
      </Text>
      {selected && <Text style={[styles.check, { color: accent }]}>✓</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // App parity (EncounterDetails' template button): muted surface, border,
  // rounded-xl, icon + name + chevron-down.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
  },
  chevronDown: {
    transform: [{ rotate: '90deg' }],
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: palette.textSecondary,
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingEnd: spacing.xl,
  },
  sheetClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  // maxHeight is relative to the space ABOVE the keyboard once the search
  // field focuses — keep it generous and the bottom padding small, or a
  // 3-item result list gets squeezed into 2.5 rows over dead padding.
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    maxHeight: '96%',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.textPrimary,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  list: {
    // Size to content, but SHRINK inside the sheet's maxHeight — without
    // flexShrink a long template list overflows the sheet and the bottom
    // options become unreachable.
    flexGrow: 0,
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.panel,
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    color: palette.textPrimary,
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
