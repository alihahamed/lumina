import { registerRootComponent } from 'expo'
import { initExecutorch } from 'react-native-executorch'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'

import App from './App'

// ExecuTorch downloads model weights at runtime and has no fetcher of its own —
// it needs one wired in before any of its hooks run, or every model fails to load.
// This must stay above registerRootComponent.
initExecutorch({ resourceFetcher: ExpoResourceFetcher })

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App)
