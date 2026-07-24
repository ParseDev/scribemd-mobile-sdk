const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const sdkRoot = path.resolve(__dirname, '..');
const escapedSdkRoot = sdkRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * Watches the local @scribemd-ai/mobile-sdk package (symlinked from
 * the repo root) so edits to the SDK reload live, and resolves modules from
 * both the example's and the SDK's node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sdkRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(sdkRoot, 'node_modules'),
    ],
    // The SDK root carries its own react/react-native (expo-module-scripts
    // dev deps, RN 0.82) — bundling those into this app's 0.85 binary crashes
    // at startup. Always resolve the app's copies. Same for
    // @react-native/assets-registry: two registry instances mean the SDK's
    // bundled icons register in one copy while Image reads the other —
    // icons render wrong or not at all.
    blockList: [
      new RegExp(`${escapedSdkRoot}/node_modules/react-native/.*`),
      new RegExp(`${escapedSdkRoot}/node_modules/react/.*`),
      new RegExp(`${escapedSdkRoot}/node_modules/@react-native/assets-registry/.*`),
    ],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
      '@react-native/assets-registry': path.resolve(
        __dirname,
        'node_modules/@react-native/assets-registry'
      ),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
