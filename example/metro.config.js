const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// the library root has its own copies in ../node_modules, native packages must load once
const SINGLETONS = ['react', 'react-native', 'expo', 'expo-modules-core'];
const exampleEntry = path.join(__dirname, 'index.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shared = SINGLETONS.some((p) => moduleName === p || moduleName.startsWith(`${p}/`));
  return context.resolveRequest(
    shared ? { ...context, originModulePath: exampleEntry } : context,
    moduleName,
    platform
  );
};

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  'expo-adaptive-glass': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

module.exports = config;
