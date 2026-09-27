// Local server for development: `npm run dev` in backend/.
// The phone reaches it over USB with `adb reverse tcp:8787 tcp:8787`, the same trick
// `npm run dev` at the root uses for Metro, so no deploy is needed to test Phase 5.
import { serve } from '@hono/node-server'
import app from './index.ts'

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => {
  console.log(`lumina backend on http://localhost:${port}`)
  if (!process.env.GEMINI_API_KEY) console.log('GEMINI_API_KEY is not set, /describe will 500')
})
