/**
 * Neutral slate/white palette with a single blue accent.
 * Every color used by the embedded UI lives here.
 *
 * Hosts can override the accent and background per session via
 * `<ScribeSession theme={{ accentColor, backgroundColor }} />` — the
 * resolved palette is threaded to every component through ThemeContext.
 * This is intentionally small (two knobs), not a design system.
 */
import { createContext, useContext } from 'react';

// Defaults follow the ScribeMD app identity: primary #1E40AF on slate
// neutrals (the app's own tailwind theme), stop = the app's ink pause pill.
const basePalette = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  border: '#E2E8F0',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',

  accent: '#1E40AF',
  accentSoft: '#EFF6FF',
  onAccent: '#FFFFFF',

  /** Prominent stop action: near-black slate, not a second hue. */
  stop: '#0F172A',
  onStop: '#FFFFFF',

  /** Dismissable error banner (transient failures that keep the session alive). */
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
} as const;

export type ScribePalette = { [K in keyof typeof basePalette]: string };

/**
 * Default palette. Static/neutral styles may reference it directly; anything
 * affected by the per-session theme (accent, background) must read
 * `useTheme()` instead.
 */
export const palette: ScribePalette = { ...basePalette };

/** Optional per-session theme overrides accepted by <ScribeSession>. */
export interface ScribeSessionTheme {
  /** Primary/brand color: record button, waveform, halos, selections. */
  accentColor?: string;
  /** Session card background. */
  backgroundColor?: string;
  /** Raised surfaces: transcript card, inputs, toggle tracks, pills. */
  surfaceColor?: string;
  /** Stop/finish controls (the "whole button" color). */
  stopColor?: string;
  /** Primary text (titles, transcript, timer). */
  textColor?: string;
  /** Secondary text (labels, hints; also applied to muted text). */
  secondaryTextColor?: string;
}

export function resolvePalette(theme?: ScribeSessionTheme): ScribePalette {
  if (
    !theme ||
    (!theme.accentColor &&
      !theme.backgroundColor &&
      !theme.surfaceColor &&
      !theme.stopColor &&
      !theme.textColor &&
      !theme.secondaryTextColor)
  ) {
    return palette;
  }
  return {
    ...palette,
    accent: theme.accentColor ?? palette.accent,
    background: theme.backgroundColor ?? palette.background,
    surface: theme.surfaceColor ?? palette.surface,
    surfaceMuted: theme.surfaceColor ?? palette.surfaceMuted,
    stop: theme.stopColor ?? palette.stop,
    textPrimary: theme.textColor ?? palette.textPrimary,
    textSecondary: theme.secondaryTextColor ?? palette.textSecondary,
    textMuted: theme.secondaryTextColor ?? palette.textMuted,
  };
}

export const ThemeContext = createContext<ScribePalette>(palette);

/** Resolved palette for the enclosing <ScribeSession>. Defaults outside one. */
export function useTheme(): ScribePalette {
  return useContext(ThemeContext);
}

/**
 * Derive a translucent tint from any hex color — keeps halos, chips and
 * selected states coherent with whatever accent the host passes.
 */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  if (full.length !== 6) return hex;
  const int = parseInt(full, 16);
  if (Number.isNaN(int)) return hex;
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/** One shared elevation for every raised surface — calm, consistent. */
export const cardShadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export const radii = {
  card: 20,
  panel: 16,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
