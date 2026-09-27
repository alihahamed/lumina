import { Hono } from 'hono'

// One job: keep GEMINI_API_KEY off the phone. See PRD.md sections 4-5.
const MODEL = 'gemini-2.5-flash-lite'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// The prompt lives here, not in the request, so a leaked endpoint URL cannot be used
// as a free general-purpose Gemini proxy. Spoken aloud, so short and no markdown.
const PROMPT =
  'You are helping a blind person move around indoors. Describe this scene in at most ' +
  'three short sentences for text-to-speech. Say what is directly ahead, then anything on ' +
  'the left or right, then any hazard (stairs, glass, wet floor, open door). Give rough ' +
  'distances in steps. Plain words, no lists, no markdown.'

// Base64 chars, roughly 3 MB of JPEG. The phone downsizes before sending.
const MAX_IMAGE_CHARS = 4_000_000

type Env = { GEMINI_API_KEY: string }

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) => c.json({ ok: true }))

// ponytail: no auth or rate limit, anyone with the URL spends our free tier.
// Replace with a Supabase JWT check and a per-user limit before sharing the URL.
app.post('/describe', async (c) => {
  const body = await c.req.json<{ image?: unknown }>().catch(() => null)
  const image = body?.image
  if (typeof image !== 'string' || image.length === 0) {
    return c.json({ error: 'image (base64 JPEG) is required' }, 400)
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return c.json({ error: 'image too large' }, 413)
  }

  // Vercel exposes env vars on process.env, Workers on c.env. Support both.
  const key = c.env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY
  if (!key) return c.json({ error: 'server not configured' }, 500)

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: image } }] },
      ],
      generationConfig: { maxOutputTokens: 150, temperature: 0.2 },
    }),
  })

  if (!res.ok) {
    // Never forward Gemini's error body: it can echo request details.
    return c.json({ error: 'upstream failed', status: res.status }, 502)
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) return c.json({ error: 'empty response' }, 502)
  return c.json({ text })
})

export default app
