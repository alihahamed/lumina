import 'react-native-url-polyfill/auto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { File, Paths } from 'expo-file-system'

/**
 * Phase 6 database (PRD section 7). Values come from the gitignored root `.env`; the
 * publishable key is public by design, row-level security is what protects the data.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

// Session storage in the app's private files dir. The anonymous user's session must
// survive restarts: a new anonymous user each launch would lose every saved place,
// because RLS scopes places to the user. expo-file-system rather than AsyncStorage:
// it is already in the native build, AsyncStorage would need another rebuild.
const fileFor = (key: string) => new File(Paths.document, `sb-${key.replace(/[^a-z0-9_-]/gi, '_')}.json`)
const storage = {
  getItem: async (key: string) => {
    const f = fileFor(key)
    return f.exists ? await f.text() : null
  },
  setItem: async (key: string, value: string) => {
    fileFor(key).write(value)
  },
  removeItem: async (key: string) => {
    const f = fileFor(key)
    if (f.exists) f.delete()
  },
}

export const supabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null

/**
 * The user id, signing in anonymously the first time. No email or password: a blind
 * user should not have to type credentials to use place memory.
 */
export async function ensureSignedIn(): Promise<string> {
  if (supabase == null) throw new Error('Supabase is not configured (root .env)')
  const { data } = await supabase.auth.getSession()
  if (data.session != null) return data.session.user.id
  const signIn = await supabase.auth.signInAnonymously()
  if (signIn.error != null || signIn.data.user == null) {
    throw signIn.error ?? new Error('anonymous sign-in failed')
  }
  return signIn.data.user.id
}
