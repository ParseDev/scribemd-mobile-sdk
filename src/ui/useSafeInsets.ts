/**
 * Minimal safe-area insets WITHOUT a hard dependency on
 * react-native-safe-area-context (bare hosts may not ship it).
 *
 * Strategy:
 * 1. If the host app has react-native-safe-area-context installed (declared
 *    as an OPTIONAL peer), read `initialWindowMetrics` from it — exact
 *    device insets, no <SafeAreaProvider> required. The try/require pattern
 *    is tolerated by Metro (`transformer.allowOptionalDependencies` is on by
 *    default in @react-native/metro-config and @expo/metro-config).
 * 2. Otherwise fall back to conservative platform padding:
 *    - iOS: 59pt top clears the dynamic island and every notch (slightly
 *      generous on older rectangular screens, never unsafe); 34pt bottom
 *      clears the home indicator.
 *    - Android: StatusBar.currentHeight (Android-only API) with a 24dp
 *      default; gesture nav insets are ignored (content isn't obscured).
 */
import { Platform, StatusBar } from 'react-native';

export interface SafeInsets {
  top: number;
  bottom: number;
}

// CommonJS require, typed loosely so the optional dependency can be probed.
declare const require: ((moduleId: string) => any) | undefined;

const detectedInsets: SafeInsets | null = (() => {
  try {
    if (typeof require !== 'function') return null;
    // Optional peer — only used when the host already ships it.
    const safeArea = require('react-native-safe-area-context');
    const insets = safeArea?.initialWindowMetrics?.insets;
    if (insets && typeof insets.top === 'number' && typeof insets.bottom === 'number') {
      return { top: insets.top, bottom: insets.bottom };
    }
  } catch {
    // Not installed in the host — fall through to the platform fallback.
  }
  return null;
})();

const FALLBACK_INSETS: SafeInsets = Platform.select({
  ios: { top: 59, bottom: 34 },
  default: { top: StatusBar.currentHeight ?? 24, bottom: 0 },
});

/** Safe-area insets for the session card (top header / bottom controls). */
export function useSafeInsets(): SafeInsets {
  return detectedInsets ?? FALLBACK_INSETS;
}
