import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { palette, radii, spacing, useTheme, withAlpha } from './theme';
import { strings } from '../strings';
import type { EncounterMode } from '../api/encounters';

export interface GenerationProgressProps {
  mode: EncounterMode;
  /** Still finalizing (flushing/uploading) — the first stage is active. */
  finalizing: boolean;
  /** Last summary_status seen from the server (waiting/running/...). */
  serverStatus: string | null;
  /** True once streamed note content is arriving. */
  receiving: boolean;
}

type StageState = 'done' | 'active' | 'pending';

/**
 * Staged post-recording progress (replaces the anonymous jumping dots):
 * each server-side step is a row that checks off as the pipeline advances.
 */
export function GenerationProgress({
  mode,
  finalizing,
  serverStatus,
  receiving,
}: GenerationProgressProps): React.ReactElement {
  const theme = useTheme();

  const stages =
    mode === 'visit'
      ? [strings.stageUploading, strings.stageTranscribing, strings.stageGenerating]
      : [strings.stageSavingTranscript, strings.stageGenerating];

  // Finalizing = stage 0 (flush/upload). Once finalize succeeds: visit moves
  // through batch transcription (summary_status 'waiting') then generation
  // ('running' / streamed content); dictation goes straight to generation.
  let activeIndex: number;
  if (finalizing) {
    activeIndex = 0;
  } else if (mode === 'visit') {
    activeIndex = receiving || serverStatus === 'running' ? 2 : 1;
  } else {
    activeIndex = 1;
  }

  return (
    <View style={[styles.panel, { backgroundColor: withAlpha(theme.accent, 0.05) }]}>
      <View style={styles.stages}>
        {stages.map((label, index) => {
          const state: StageState =
            index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return <StageRow key={label} label={label} state={state} accent={theme.accent} />;
        })}
      </View>
      {/* Shimmering document skeleton through every stage (web parity: the
          note "writes itself" while the pipeline works). */}
      <View style={[styles.skeletonCard, { backgroundColor: theme.surface }]}>
        <SkeletonLine width="35%" delay={0} />
        <SkeletonLine width="100%" delay={140} />
        <SkeletonLine width="92%" delay={280} />
        <SkeletonLine width="65%" delay={420} />
        <View style={styles.skeletonGap} />
        <SkeletonLine width="28%" delay={560} />
        <SkeletonLine width="88%" delay={700} />
      </View>
    </View>
  );
}

function SkeletonLine({ width, delay }: { width: `${number}%`; delay: number }): React.ReactElement {
  const shimmer = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, delay]);

  return <Animated.View style={[styles.skeletonLine, { width, opacity: shimmer }]} />;
}

function StageRow({
  label,
  state,
  accent,
}: {
  label: string;
  state: StageState;
  accent: string;
}): React.ReactElement {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'active') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  return (
    <View style={styles.stageRow}>
      {state === 'done' ? (
        <View style={[styles.stageBadge, { backgroundColor: accent }]}>
          <View style={styles.stageCheck} />
        </View>
      ) : state === 'active' ? (
        <View style={[styles.stageBadge, { backgroundColor: withAlpha(accent, 0.15) }]}>
          <Animated.View
            style={[styles.stageDot, { backgroundColor: accent, opacity: pulse }]}
          />
        </View>
      ) : (
        <View style={[styles.stageBadge, styles.stagePending]} />
      )}
      <Text
        style={[
          styles.stageLabel,
          {
            color:
              state === 'pending'
                ? theme.textMuted
                : state === 'active'
                  ? theme.textPrimary
                  : theme.textSecondary,
            fontWeight: state === 'active' ? '600' : '500',
          },
        ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.panel,
  },
  stages: {
    gap: spacing.lg,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stageBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagePending: {
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  stageCheck: {
    width: 11,
    height: 6,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ rotate: '-45deg' }, { translateY: -1 }],
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stageLabel: {
    fontSize: 15,
  },
  skeletonCard: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    marginHorizontal: spacing.xl,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: 10,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.border,
  },
  skeletonGap: {
    height: 6,
  },
});
