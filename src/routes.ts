import { File, Paths } from 'expo-file-system'
import { toPgVector } from './placeMatch'
import type { Checkpoint } from './routeLogic'
import { ensureSignedIn, supabase } from './supabase'

/**
 * Saved walking routes (src/routeLogic.ts).
 *
 * The phone's own copy is the one guidance uses: a file per destination, so recording
 * and following work with no network. Guidance must not die because a free database
 * paused itself (it did, 2026-11-12) or a corridor has no signal.
 *
 * A copy also goes to Supabase when it can, in the PRD section 7 tables as they are: one
 * `routes` row per destination, one `anchors` row per checkpoint, in walking order. The
 * leg, step and turn live in `pose`, which the schema left as free jsonb; ARCore never
 * filled it. Matching happens on the phone, in sequence, so `match_anchors` is not used.
 * ponytail: the cloud copy is write-only. Nothing downloads it to a second phone yet.
 */
const fileFor = (name: string) => new File(Paths.document, `route-${key(name).replace(/[^a-z0-9]+/g, '_')}.json`)

function db() {
  if (supabase == null) throw new Error('Supabase is not configured (root .env)')
  return supabase
}

// "My places" (src/places.ts) is also a route row; a destination can never collide with
// it because these are stored lower-case.
const key = (name: string) => name.trim().toLowerCase()

// The column is `not null`, and a checkpoint whose photo failed has no view. Zeros match
// nothing (cosine() returns 0 for them).
const NO_VIEW = new Array(512).fill(0)

/** Saves a route on the phone, replacing any earlier one to the same destination. */
export function saveRoute(name: string, checkpoints: Checkpoint[]): void {
  fileFor(name).write(JSON.stringify(checkpoints))
  void upload(name, checkpoints).catch((e) => console.warn('route cloud copy failed', String(e)))
}

async function upload(name: string, checkpoints: Checkpoint[]): Promise<void> {
  await ensureSignedIn()
  const gone = await db().from('routes').delete().eq('name', key(name))
  if (gone.error != null) throw gone.error
  const made = await db().from('routes').insert({ name: key(name) }).select('id').single()
  if (made.error != null) throw made.error
  const res = await db()
    .from('anchors')
    .insert(
      checkpoints.map((c, seq) => ({
        route_id: made.data.id as string,
        seq,
        label: c.turn === 'arrive' ? key(name) : null,
        pose: { leg: c.leg, step: c.step, ...(c.turn ? { turn: c.turn } : {}) },
        descriptor: toPgVector(c.descriptor.length === NO_VIEW.length ? c.descriptor : NO_VIEW),
      })),
    )
  if (res.error != null) throw res.error
}

/** @returns the checkpoints in walking order, or null when no such route is saved. */
export async function loadRoute(name: string): Promise<Checkpoint[] | null> {
  const f = fileFor(name)
  return f.exists ? (JSON.parse(await f.text()) as Checkpoint[]) : null
}
