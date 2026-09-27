import { Hono } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// One job: keep GEMINI_API_KEY off the phone. See PRD.md sections 4-5.
//
// Not the PRD's gemini-2.5-flash-lite: since 2026 Google only serves the 2.5 models to
// accounts that already used them, so a fresh key would be refused.
//
// 3.1 first, 3.5 second, on measurement (2026-09-27, free tier, 30 calls): 3.1 answered
// 10/10 in 2.1-4.6 s; 3.5 hung on 11/20. 3.1 shuts down May 2027. A shut-down model
// returns 404, which falls through to 3.5, so that date fails soft rather than hard.
// Both overridable (GEMINI_MODEL, GEMINI_FALLBACK_MODEL). docs/decisions.md 2026-09-27.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'
const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite'

// The prompt lives here, not in the request, so a leaked endpoint URL cannot be used
// as a free general-purpose Gemini proxy. Spoken aloud, so short and no markdown.
const PROMPT =
  'You are helping a blind person move around indoors. Describe this scene in at most ' +
  'three short sentences for text-to-speech. Say what is directly ahead, then anything on ' +
  'the left or right, then any hazard (stairs, glass, wet floor, open door). Give rough ' +
  'distances in steps. Plain words, no lists, no markdown.'

// Base64 chars, roughly 3 MB of JPEG. The phone sends ~768x1024, far under this.
const MAX_IMAGE_CHARS = 4_000_000

// Measured 2026-09-27 on the free tier: answered calls take 2-4.6 s, but a hung call
// never answers at all (one still silent at 45 s). Latency is bimodal, answer-or-hang,
// so waiting longer buys nothing. Give each attempt 8 s, then
// try the other model once. Worst case 16 s, inside the app's 18 s.
const ATTEMPT_TIMEOUT_MS = 8_000

type Env = {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GEMINI_FALLBACK_MODEL?: string
  SUPABASE_URL?: string
}

// Vercel and plain Node expose env on process.env, Workers on c.env. Support both.
const envOf = (env: Env | undefined, name: keyof Env): string | undefined =>
  env?.[name] ?? process.env[name]

// Supabase signs user tokens with ES256 and publishes the public keys, so tokens are
// verified here with no call to Supabase per request and no shared secret. jose caches
// the key set. One per Supabase URL (there is only ever one).
const jwksFor = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
function jwks(supabaseUrl: string) {
  let set = jwksFor.get(supabaseUrl)
  if (set == null) {
    set = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))
    jwksFor.set(supabaseUrl, set)
  }
  return set
}

/** The Supabase user id if the bearer token is valid, else null. */
async function verifiedUser(supabaseUrl: string, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (token == null) return null
  try {
    const { payload } = await jwtVerify(token, jwks(supabaseUrl), {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ ok: true }))

app.post('/describe', async (c) => {
  // Only signed-in Lumina users (the app signs in anonymously, Phase 6). With
  // SUPABASE_URL unset the check is off — local development only; the deployed backend
  // must set it. ponytail: no per-user rate limit. Anyone can mint anonymous users
  // with the public key, but Supabase rate-limits anonymous sign-ups per IP, which
  // bounds that. Add a per-user daily cap (a Supabase table) if the free tier is abused.
  const supabaseUrl = envOf(c.env, 'SUPABASE_URL')
  if (supabaseUrl) {
    const user = await verifiedUser(supabaseUrl, c.req.header('authorization'))
    if (user == null) return c.json({ error: 'unauthorized' }, 401)
  }

  const body = await c.req.json<{ image?: unknown }>().catch(() => null)
  const image = body?.image
  if (typeof image !== 'string' || image.length === 0) {
    return c.json({ error: 'image (base64 JPEG) is required' }, 400)
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return c.json({ error: 'image too large' }, 413)
  }

  const key = envOf(c.env, 'GEMINI_API_KEY')
  if (!key) return c.json({ error: 'server not configured' }, 500)
  const models = [
    envOf(c.env, 'GEMINI_MODEL') || DEFAULT_MODEL,
    envOf(c.env, 'GEMINI_FALLBACK_MODEL') || DEFAULT_FALLBACK_MODEL,
  ]

  let last: Outcome = { kind: 'unreachable' }
  for (const model of models) {
    last = await askGemini(model, key, image)
    if (last.kind === 'ok') return c.json({ text: last.text })
    // A 4xx is usually our request's fault and the other model will reject it too, so
    // stop rather than burn another 8 s. Except 429 (rate limit, per model) and 404
    // (model shut down or renamed), where the other model is exactly the answer.
    if (last.kind === 'http' && last.status < 500 && last.status !== 429 && last.status !== 404)
      break
  }
  switch (last.kind) {
    case 'timeout':
      return c.json({ error: 'upstream timeout' }, 504)
    case 'unreachable':
      return c.json({ error: 'upstream unreachable' }, 504)
    case 'empty':
      return c.json({ error: 'empty response' }, 502)
    case 'http':
      return c.json({ error: 'upstream failed', status: last.status }, 502)
  }
})

type Outcome =
  | { kind: 'ok'; text: string }
  | { kind: 'timeout' | 'unreachable' | 'empty' }
  | { kind: 'http'; status: number }

async function askGemini(model: string, key: string, image: string): Promise<Outcome> {
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: image } }],
            },
          ],
          generationConfig: {
            // Thought tokens count against maxOutputTokens on Gemini 3; at 150 a thinking
            // model could spend the lot and return nothing. Minimal thinking also keeps
            // latency down. Verified accepted by both models 2026-09-27.
            maxOutputTokens: 400,
            temperature: 0.2,
            thinkingConfig: { thinkingLevel: 'minimal' },
          },
        }),
      },
    )
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError'
    console.warn('gemini', model, timedOut ? 'timeout' : 'unreachable', Date.now() - t0, 'ms')
    return { kind: timedOut ? 'timeout' : 'unreachable' }
  }

  if (!res.ok) {
    // Log for us (server logs are private), never forward to the client: Gemini's error
    // body can echo request details.
    console.error('gemini', model, res.status, (await res.text()).slice(0, 500))
    return { kind: 'http', status: res.status }
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join(' ')
    .trim()
  console.log('gemini', model, 'ok', Date.now() - t0, 'ms')
  return text ? { kind: 'ok', text } : { kind: 'empty' }
}

export default app
