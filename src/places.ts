import { bestMatch, type Candidate, toPgVector } from './placeMatch'
import { ensureSignedIn, supabase } from './supabase'

/**
 * Phase 6, recognition first (docs/decisions.md): save a place as a CLIP descriptor
 * with a spoken name, later say which saved place this looks like. No guidance between
 * places yet — that needs ARCore to own the camera. Schema: PRD section 7.
 *
 * Every place lives on one route per user, "My places". The schema is route-shaped for
 * the guidance version later; match_anchors needs a route id either way.
 */
const ROUTE_NAME = 'My places'

function db() {
  if (supabase == null) throw new Error('Supabase is not configured (root .env)')
  return supabase
}

async function myRouteId(): Promise<string> {
  await ensureSignedIn()
  const found = await db().from('routes').select('id').eq('name', ROUTE_NAME).limit(1)
  if (found.error != null) throw found.error
  if (found.data.length > 0) return found.data[0].id as string
  const made = await db().from('routes').insert({ name: ROUTE_NAME }).select('id').single()
  if (made.error != null) throw made.error
  return made.data.id as string
}

/** Saves one view. Saving the same name again adds another view, which helps recall. */
export async function savePlace(label: string, descriptor: ArrayLike<number>): Promise<void> {
  const route = await myRouteId()
  const count = await db().from('anchors').select('id', { count: 'exact', head: true }).eq('route_id', route)
  if (count.error != null) throw count.error
  const res = await db()
    .from('anchors')
    .insert({ route_id: route, seq: count.count ?? 0, label, descriptor: toPgVector(descriptor) })
  if (res.error != null) throw res.error
}

/**
 * @returns the best match over the threshold (or null), plus the top similarity even
 * when it is under, for tuning the threshold on the debug overlay.
 */
export async function matchPlace(
  descriptor: ArrayLike<number>,
): Promise<{ match: { label: string; similarity: number } | null; top: Candidate | null }> {
  const route = await myRouteId()
  const res = await db().rpc('match_anchors', { query: toPgVector(descriptor), route, k: 5 })
  if (res.error != null) throw res.error
  const candidates = (res.data ?? []) as Candidate[]
  return { match: bestMatch(candidates), top: candidates[0] ?? null }
}
