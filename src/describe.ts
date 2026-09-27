import { File } from 'expo-file-system'

/**
 * Phase 5, the "REASONING" tier (PRD section 4): one photo to the backend's
 * `/describe`, which asks Gemini, and gets a short spoken description back. Cloud only,
 * so this is only ever entered because the user asked, never on a timer.
 *
 * Dev default is the laptop over USB (`adb reverse tcp:8787 tcp:8787`, backend
 * `npm run dev`). Set EXPO_PUBLIC_DESCRIBE_URL to the deployed URL for anything else.
 * EXPO_PUBLIC_ values are baked into the app bundle: fine for a URL, and the token is
 * only a speed bump, see backend/src/index.ts.
 */
const BASE_URL = process.env.EXPO_PUBLIC_DESCRIBE_URL ?? 'http://localhost:8787'
const TOKEN = process.env.EXPO_PUBLIC_LUMINA_TOKEN

// A little over the backend's own 15 s upstream timeout, so the backend's clearer
// error wins when both would fire.
const TIMEOUT_MS = 18_000

/** Why a description failed, in words the user can act on. */
export class DescribeError extends Error {
  constructor(readonly spoken: string) {
    super(spoken)
  }
}

/**
 * @param uri A `file://` URI to a JPEG still.
 * @returns A few short sentences for text-to-speech.
 * @throws DescribeError with a sentence fit to speak.
 */
export async function describeScene(uri: string): Promise<string> {
  const image = await new File(uri).base64()

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/describe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TOKEN ? { 'x-lumina-token': TOKEN } : {}),
      },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // No network, server down, or timeout. Phase 7's offline VLM is the real answer.
    throw new DescribeError('Cannot describe right now. Check the internet connection.')
  }

  if (res.status === 504) throw new DescribeError('That took too long. Try again.')
  if (!res.ok) throw new DescribeError('Could not describe that.')
  const data = (await res.json()) as { text?: string }
  if (!data.text) throw new DescribeError('Could not describe that.')
  return data.text
}
