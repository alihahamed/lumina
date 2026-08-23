module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Must be last — it compiles the 'worklet' directives the frame processor needs.
    plugins: ['react-native-worklets/plugin'],
  }
}
