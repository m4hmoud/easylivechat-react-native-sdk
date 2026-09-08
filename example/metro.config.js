// Metro, taught about the monorepo.
//
// The two SDK packages live in ../packages and are consumed straight from
// their TypeScript sources (their package.json `react-native` field points at
// src/index.ts), so Metro has to be allowed to reach outside this app folder —
// and has to be told NOT to follow the hoisted duplicates of react/react-native
// it would otherwise find up there, which is the classic "Invalid hook call /
// two Reacts" failure in an RN monorepo.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// One copy of each, always this app's.
for (const name of ['react', 'react-native']) {
  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    [name]: path.resolve(projectRoot, 'node_modules', name),
  };
}

module.exports = config;
