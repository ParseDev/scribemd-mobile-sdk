import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TablerIcon } from './icons';
import {
  RichMarkdownEditor,
  isRichEditorAvailable,
  type RichMarkdownEditorHandle,
} from './RichMarkdownEditor';
import { cardShadow, palette, radii, spacing, useTheme } from './theme';
import { isRtlLanguage, strings } from '../strings';
import type { GeneratedNote } from '../api/encounters';

export interface NoteReviewProps {
  note: GeneratedNote;
  language?: string;
  saving?: boolean;
  /** Called with the (possibly edited) note when the doctor approves. */
  onApprove: (edited: GeneratedNote) => void;
}

interface SectionDraft {
  key: string;
  title: string;
  /** Long generator keys are lead-in sentences, not headings. */
  titleIsSentence: boolean;
  text: string;
  wasArray: boolean;
  wasNone: boolean;
}

/** '1_Subjective' -> 'Subjective', 'physical_exam' -> 'Physical exam'. */
function sectionTitle(key: string): string {
  const cleaned = key.replace(/^\d+_/, '').replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Generator convention for an intentionally empty section. */
function isNoneText(text: string): boolean {
  return text.trim().toLowerCase() === 'none' || text.trim() === '';
}

function buildSections(json: NonNullable<GeneratedNote['json']>): SectionDraft[] {
  // json_notes keys carry a numeric order prefix ('1_Subjective') — sort by
  // it; raw object order is not reliable.
  const entries = Object.entries(json);
  entries.sort(([a], [b]) => {
    const orderA = /^(\d+)/.exec(a);
    const orderB = /^(\d+)/.exec(b);
    if (orderA && orderB) return Number(orderA[1]) - Number(orderB[1]);
    if (orderA) return -1;
    if (orderB) return 1;
    return 0;
  });
  return entries.map(([key, value]) => {
    const raw = Array.isArray(value) ? value.join('\n') : String(value ?? '');
    const title = sectionTitle(key);
    const wasNone = isNoneText(raw);
    return {
      key,
      title,
      titleIsSentence: title.length > 34,
      text: wasNone ? '' : raw,
      wasArray: Array.isArray(value),
      wasNone,
    };
  });
}

// --- Lightweight note rendering (read mode) --------------------------------
// Just enough markdown for generated notes: **bold** spans and bullet lines.

function renderInline(text: string, boldStyle: object): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Text key={index} style={boldStyle}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Text key={index}>{part}</Text>
    )
  );
}

function NoteBody({
  text,
  color,
  rtl,
}: {
  text: string;
  color: string;
  rtl: boolean;
}): React.ReactElement {
  // Collapse runs of blank lines — generated markdown often carries 3-4 in
  // a row, which reads as broken layout on a phone.
  const lines = text.replace(/\n{3,}/g, '\n\n').split('\n');
  const textRtl = rtl ? styles.textRtl : null;
  return (
    <View style={styles.noteBody}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return <View key={index} style={styles.blankLine} />;
        }
        const bullet = /^[-*•]\s+/.test(trimmed);
        const content = bullet ? trimmed.replace(/^[-*•]\s+/, '') : trimmed;
        return (
          <View key={index} style={[styles.bodyLine, rtl && styles.rowRtl]}>
            {bullet && <Text style={[styles.bulletMark, { color }]}>•</Text>}
            <Text style={[styles.bodyText, { color }, textRtl]}>
              {renderInline(content, styles.bodyBold)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * In-SDK note review. Read mode renders the note the way it will look
 * (ordered sections, bold/bullets formatted, empty sections quiet); tapping
 * a section switches just that section into an editor. The host's
 * onComplete fires only after the doctor approves.
 */
export function NoteReview({
  note,
  language,
  saving = false,
  onApprove,
}: NoteReviewProps): React.ReactElement {
  const theme = useTheme();
  const rtl = isRtlLanguage(language);
  const textRtl = rtl ? styles.textRtl : null;

  const isSectioned = note.json != null && Object.keys(note.json).length > 0;

  const [sections, setSections] = useState<SectionDraft[]>(() =>
    isSectioned ? buildSections(note.json!) : []
  );
  const [markdownText, setMarkdownText] = useState(note.markdown ?? note.plain ?? '');
  /** Section key currently being edited ('__markdown__' for the doc editor). */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const richEditorRef = useRef<RichMarkdownEditorHandle>(null);
  const useRichEditor = !isSectioned && isRichEditorAvailable;

  const approve = async () => {
    if (saving) return;
    if (isSectioned) {
      const json: { [section: string]: string | string[] } = {};
      for (const section of sections) {
        const text = section.text.trim().length === 0 ? 'None' : section.text;
        json[section.key] = section.wasArray ? text.split('\n') : text;
      }
      onApprove({ ...note, json });
    } else {
      const markdown = useRichEditor
        ? ((await richEditorRef.current?.getMarkdown()) ?? markdownText)
        : markdownText;
      onApprove({ ...note, markdown, plain: markdown });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {useRichEditor ? (
        // TipTap (same engine as the web app) — has its own internal scroll.
        <RichMarkdownEditor
          ref={richEditorRef}
          initialMarkdown={markdownText}
          editable={!saving}
        />
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.noteCard, { backgroundColor: theme.surface }]}>
          {isSectioned ? (
            sections.map((section, index) => {
              const editing = editingKey === section.key;
              const empty = section.text.trim().length === 0;
              return (
                <View key={section.key}>
                  {index > 0 && <View style={styles.divider} />}
                  <Pressable
                    disabled={saving || editing}
                    onPress={() => setEditingKey(section.key)}
                    style={styles.section}>
                    <View style={[styles.sectionHeader, rtl && styles.rowRtl]}>
                      <Text
                        style={[
                          section.titleIsSentence
                            ? [styles.sentenceTitle, { color: theme.textPrimary }]
                            : [styles.sectionTitle, { color: theme.accent }],
                          styles.sectionTitleFlex,
                          textRtl,
                        ]}>
                        {section.title}
                      </Text>
                      {!editing && (
                        <TablerIcon name="pencil" size={13} color={theme.textMuted} />
                      )}
                    </View>
                    {editing ? (
                      <TextInput
                        style={[styles.sectionInput, { color: theme.textPrimary }, textRtl]}
                        value={section.text}
                        onChangeText={(text) =>
                          setSections((previous) =>
                            previous.map((entry, at) =>
                              at === index ? { ...entry, text } : entry
                            )
                          )
                        }
                        multiline
                        autoFocus
                        scrollEnabled={false}
                        textAlignVertical="top"
                        editable={!saving}
                        onBlur={() => setEditingKey(null)}
                        accessibilityLabel={section.title}
                      />
                    ) : empty ? (
                      <Text style={[styles.emptyText, { color: theme.textMuted }, textRtl]}>
                        —
                      </Text>
                    ) : (
                      <NoteBody text={section.text} color={theme.textPrimary} rtl={rtl} />
                    )}
                  </Pressable>
                </View>
              );
            })
          ) : editingKey === '__markdown__' ? (
            <TextInput
              style={[styles.markdownInput, { color: theme.textPrimary }, textRtl]}
              value={markdownText}
              onChangeText={setMarkdownText}
              multiline
              autoFocus
              scrollEnabled={false}
              textAlignVertical="top"
              editable={!saving}
              onBlur={() => setEditingKey(null)}
              accessibilityLabel={strings.reviewNoteTitle}
            />
          ) : (
            <Pressable
              disabled={saving}
              onPress={() => setEditingKey('__markdown__')}
              style={styles.section}>
              <View style={[styles.sectionHeader, rtl && styles.rowRtl]}>
                <View style={styles.sectionTitleFlex} />
                <TablerIcon name="pencil" size={13} color={theme.textMuted} />
              </View>
              <NoteBody text={markdownText} color={theme.textPrimary} rtl={rtl} />
            </Pressable>
          )}
        </View>
      </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.approveNote}
        onPress={approve}
        disabled={saving}
        style={({ pressed }) => [
          styles.approveButton,
          { backgroundColor: theme.accent, shadowColor: theme.accent },
          pressed && styles.pressed,
          saving && styles.disabled,
        ]}>
        {saving ? (
          <>
            <ActivityIndicator size="small" color={palette.onAccent} />
            <Text style={styles.approveLabel}>{strings.savingNote}</Text>
          </>
        ) : (
          <Text style={styles.approveLabel}>{strings.approveNote}</Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  noteCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    ...cardShadow,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    opacity: 0.6,
  },
  section: {
    paddingVertical: spacing.md,
    gap: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitleFlex: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Long generator keys read as lead-in sentences, not headings.
  sentenceTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  noteBody: {
    gap: 2,
  },
  bodyLine: {
    flexDirection: 'row',
    gap: 6,
  },
  bulletMark: {
    fontSize: 15,
    lineHeight: 22,
  },
  bodyText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyBold: {
    fontWeight: '700',
  },
  blankLine: {
    height: 8,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  sectionInput: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.textPrimary,
    padding: 0,
    margin: 0,
    minHeight: 44,
  },
  markdownInput: {
    minHeight: 320,
    fontSize: 15,
    lineHeight: 22,
    color: palette.textPrimary,
    paddingVertical: spacing.md,
    padding: 0,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: radii.pill,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  approveLabel: {
    color: palette.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.6,
  },
});
