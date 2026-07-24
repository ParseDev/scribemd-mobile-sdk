/**
 * Tabler icons — the exact glyphs the ScribeMD app uses — bundled as tiny
 * PNG assets (1x/2x/3x, ~9KB total; MIT, rendered from
 * @tabler/icons-react-native v3.35.0 path data) and themed at runtime via
 * Image tintColor. Zero native dependencies: no react-native-svg, no icon
 * font linking — works identically in every host app.
 */
import React from 'react';
import { Image } from 'react-native';

export type TablerIconName =
  | 'template'
  | 'writing'
  | 'user'
  | 'search'
  | 'x'
  | 'pencil'
  | 'play'
  | 'pause'
  | 'chevron';

/* eslint-disable @typescript-eslint/no-require-imports */
const ICONS: Record<TablerIconName, number> = {
  template: require('../../assets/icons/icon-template.png'),
  writing: require('../../assets/icons/icon-writing.png'),
  user: require('../../assets/icons/icon-user.png'),
  search: require('../../assets/icons/icon-search.png'),
  x: require('../../assets/icons/icon-x.png'),
  pencil: require('../../assets/icons/icon-pencil.png'),
  play: require('../../assets/icons/icon-play.png'),
  pause: require('../../assets/icons/icon-pause.png'),
  chevron: require('../../assets/icons/icon-chevron.png'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export interface TablerIconProps {
  name: TablerIconName;
  size?: number;
  color: string;
}

export function TablerIcon({ name, size = 18, color }: TablerIconProps): React.ReactElement {
  return (
    <Image
      source={ICONS[name]}
      style={{ width: size, height: size, tintColor: color, resizeMode: 'contain' }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
