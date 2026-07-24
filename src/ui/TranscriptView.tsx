import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AnimatedDots } from './AnimatedDots';
import { cardShadow, palette, radii, useTheme } from './theme';
import { isRtlLanguage, strings } from '../strings';

export interface TranscriptItem {
  id: string;
  text: string;
}

export interface TranscriptViewProps {
  /** Finalized segments, oldest first. */
  segments: TranscriptItem[];
  /** Current interim hypothesis, rendered dimmed under the finals. */
  interimText: string;
  /**
   * Transcript language (provider language). RTL languages (he, ar, …)
   * render right-aligned with RTL writing direction, independent of the
   * host app's own I18nManager layout direction.
   */
  language?: string;
  /** Paused sessions show a static "Paused" empty state, not "Listening…". */
  paused?: boolean;
}

// Bound the number of native views; older segments stay in state upstream.
const MAX_RENDERED_SEGMENTS = 50;

/** Auto-scrolling live transcript: finalized text plus a dimmed interim line. */
export function TranscriptView({
  segments,
  interimText,
  language,
  paused = false,
}: TranscriptViewProps): React.ReactElement {
  const scrollViewRef = useRef<ScrollView>(null);
  const visibleSegments = segments.slice(-MAX_RENDERED_SEGMENTS);
  const isEmpty = visibleSegments.length === 0 && interimText.length === 0;
  // Alignment follows the TRANSCRIPT language, not I18nManager.isRTL: an
  // LTR host app can still record a Hebrew visit (and vice versa). Row
  // layouts elsewhere use flexDirection/logical props, which RN mirrors
  // automatically when the host app itself is RTL.
  const rtlText = isRtlLanguage(language) ? styles.rtlText : null;
  const theme = useTheme();

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface }]}>
      <Text style={[styles.title, { color: theme.textMuted }]}>{strings.transcriptTitle}</Text>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={isEmpty ? styles.emptyContent : styles.content}
        showsVerticalScrollIndicator
        onContentSizeChange={() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }}>
        {isEmpty ? (
          <View style={styles.emptyStack}>
            {!paused && <AnimatedDots />}
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {paused ? strings.statusPaused : strings.transcriptEmpty}
            </Text>
          </View>
        ) : (
          <>
            {visibleSegments.map((segment) => (
              <Text key={segment.id} style={[styles.finalText, { color: theme.textPrimary }, rtlText]}>
                {segment.text}
              </Text>
            ))}
            {interimText.length > 0 && (
              <Text style={[styles.interimText, { color: theme.textMuted }, rtlText]}>
                {interimText}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 160,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    padding: 14,
    ...cardShadow,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 10,
  },
  emptyStack: {
    alignItems: 'center',
    gap: 10,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 10,
    paddingBottom: 4,
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: palette.textMuted,
    textAlign: 'center',
  },
  finalText: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.textPrimary,
  },
  // Italic: visually separates the in-flight hypothesis from settled text.
  interimText: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
