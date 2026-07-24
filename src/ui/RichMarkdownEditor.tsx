/**
 * Rich markdown editor — the SAME engine as the ScribeMD web app: TipTap,
 * via @10play/tentap-editor (TipTap in a WebView with a native bridge).
 *
 * Both @10play/tentap-editor and react-native-webview are OPTIONAL peers:
 * when the host hasn't installed them, callers fall back to the built-in
 * plain-text editor (check `isRichEditorAvailable`). Markdown round-trips
 * through HTML: marked (md -> html) on load, turndown (html -> md) on save.
 *
 * tentap's stock toolbar is replaced with an SDK-styled one driving the
 * same TipTap commands, and the in-webview document is styled to match the
 * SDK type system.
 */
import { marked } from 'marked';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, StyleSheet, View } from 'react-native';
import TurndownService from 'turndown';

import { cardShadow, palette, radii, spacing, useTheme, withAlpha } from './theme';

/* eslint-disable @typescript-eslint/no-explicit-any */
let tentap: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  tentap = require('@10play/tentap-editor');
} catch {
  // Host has no tentap/webview — plain editor fallback renders instead.
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True when the host app has @10play/tentap-editor installed. */
export const isRichEditorAvailable: boolean =
  tentap != null && typeof tentap.useEditorBridge === 'function';

export interface RichMarkdownEditorHandle {
  /** Current document, converted back to markdown. */
  getMarkdown: () => Promise<string>;
}

export interface RichMarkdownEditorProps {
  initialMarkdown: string;
  editable?: boolean;
}

function markdownToHtml(markdown: string): string {
  try {
    return marked.parse(markdown, { async: false }) as string;
  } catch {
    return `<p>${markdown}</p>`;
  }
}

/** Styles the TipTap document to match the SDK type system. */
const EDITOR_CSS = `
  * { -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, system-ui, Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: ${palette.textPrimary};
    padding: 4px 16px 24px 16px;
  }
  h1, h2, h3, h4 { font-size: 16px; font-weight: 700; margin: 14px 0 4px; }
  p { margin: 6px 0; }
  strong { font-weight: 700; }
  ul, ol { padding-left: 22px; margin: 6px 0; }
  li { margin: 2px 0; }
`;

export const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, RichMarkdownEditorProps>(
  function RichMarkdownEditor({ initialMarkdown, editable = true }, ref) {
    const theme = useTheme();
    const initialContent = useMemo(() => markdownToHtml(initialMarkdown), [initialMarkdown]);

    // Keyboard-docked toolbar: measure where the keyboard's top edge lands
    // relative to this container and float the toolbar exactly on it,
    // bled to the FULL screen width (edge to edge, like a system bar).
    const containerRef = useRef<View>(null);
    const [dock, setDock] = useState<{ bottom: number; left: number; right: number } | null>(
      null
    );
    useEffect(() => {
      const place = (keyboardTopY: number) => {
        // Measure after layout settles (the screen may shift with the
        // keyboard).
        requestAnimationFrame(() => {
          containerRef.current?.measureInWindow((x, y, width, height) => {
            const windowWidth = Dimensions.get('window').width;
            setDock({
              bottom: Math.max(0, y + height - keyboardTopY),
              left: -x,
              right: -(windowWidth - x - width),
            });
          });
        });
      };
      const subscriptions = [
        Keyboard.addListener('keyboardDidShow', (event) => {
          place(event.endCoordinates.screenY);
        }),
        Keyboard.addListener('keyboardDidChangeFrame', (event) => {
          const windowHeight = Dimensions.get('window').height;
          if (event.endCoordinates.screenY >= windowHeight - 1) {
            setDock(null);
          } else {
            place(event.endCoordinates.screenY);
          }
        }),
        Keyboard.addListener('keyboardDidHide', () => setDock(null)),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    }, []);

    // Inject our design system into tentap's toolbar (their theme merge).
    const tentapTheme = useMemo(
      () => ({
        toolbar: {
          toolbarBody: {
            borderTopWidth: 0,
            borderBottomWidth: 0,
            backgroundColor: theme.surface,
            height: 50,
            paddingHorizontal: 6,
          },
          toolbarButton: {
            backgroundColor: 'transparent',
            paddingHorizontal: 7,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
          },
          iconWrapper: {
            borderRadius: 9,
            backgroundColor: 'transparent',
            padding: 5,
          },
          iconWrapperActive: {
            backgroundColor: withAlpha(theme.accent, 0.14),
          },
          icon: {
            height: 24,
            width: 24,
            tintColor: theme.textPrimary,
          },
          iconActive: {
            tintColor: theme.accent,
          },
          iconDisabled: {
            tintColor: theme.textMuted,
          },
        },
      }),
      [theme]
    );

    const bridgeExtensions = useMemo(() => {
      try {
        if (tentap.TenTapStartKit && tentap.CoreBridge?.configureCSS) {
          return [...tentap.TenTapStartKit, tentap.CoreBridge.configureCSS(EDITOR_CSS)];
        }
      } catch {
        // Fall back to tentap defaults.
      }
      return undefined;
    }, []);

    const editor = tentap.useEditorBridge({
      initialContent,
      editable,
      avoidIosKeyboard: true,
      theme: tentapTheme,
      ...(bridgeExtensions ? { bridgeExtensions } : {}),
    });

    useImperativeHandle(
      ref,
      () => ({
        async getMarkdown() {
          try {
            const html: string = await editor.getHTML();
            const turndown = new TurndownService({
              headingStyle: 'atx',
              bulletListMarker: '-',
              emDelimiter: '*',
            });
            return turndown.turndown(html);
          } catch {
            // Conversion failure must never lose the note.
            return initialMarkdown;
          }
        },
      }),
      [editor, initialMarkdown]
    );

    const RichText = tentap.RichText;
    const TentapToolbar = tentap.Toolbar;

    return (
      <View ref={containerRef} style={styles.container} collapsable={false}>
        <View style={[styles.editor, { backgroundColor: theme.surface }]}>
          <RichText editor={editor} />
        </View>
        {/* tentap's OWN Toolbar (keeps TipTap focus/selection, live active
            states), docked on the keyboard's top edge and bled to the full
            screen width like a system bar. */}
        {editable && dock != null && TentapToolbar != null && (
          <View
            style={[
              styles.toolbarShell,
              {
                backgroundColor: theme.surface,
                bottom: dock.bottom,
                left: dock.left,
                right: dock.right,
              },
            ]}>
            <View style={styles.toolbarFlex}>
              {/* hidden={false}: their Toolbar otherwise self-hides on its
                  own keyboard/focus heuristics, which lag in an embedded
                  card — WE decide visibility via the keyboard dock. */}
              <TentapToolbar editor={editor} hidden={false} />
            </View>
          </View>
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.sm,
  },
  editor: {
    flex: 1,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.panel,
    overflow: 'hidden',
    ...cardShadow,
  },
  // Edge-to-edge system-style bar: hairline top border, soft top radius.
  toolbarShell: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
    elevation: 6,
  },
  toolbarFlex: {
    flex: 1,
  },
});
