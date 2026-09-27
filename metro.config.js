// Only here to let Metro bundle ExecuTorch model files (.pte) as assets, so the depth
// model ships inside the APK (docs/decisions.md 2026-09-27). Everything else is Expo's
// default. Note: there is still deliberately no babel.config.js (HANDOFF.md).
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push('pte')

module.exports = config
