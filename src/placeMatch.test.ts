// Run with: node src/placeMatch.test.ts
import assert from 'node:assert'
import { bestMatch, MATCH_THRESHOLD, toPgVector } from './placeMatch.ts'

// --- vector format pgvector accepts
assert.equal(toPgVector([0.5, -1, 0]), '[0.5,-1,0]')
assert.equal(toPgVector(new Float32Array([0.25, 1])), '[0.25,1]')
assert.equal(toPgVector([NaN, Infinity, 1]), '[0,0,1]', 'non-finite values would make the insert fail')

// --- matching
const at = (label: string | null, similarity: number) => ({ label, similarity })
assert.deepEqual(bestMatch([at('kitchen', 0.9), at('library door', 0.95)]), { label: 'library door', similarity: 0.95 })
// Below threshold: say nothing rather than name the wrong place.
assert.equal(bestMatch([at('kitchen', MATCH_THRESHOLD - 0.01)]), null)
assert.deepEqual(bestMatch([at('kitchen', MATCH_THRESHOLD)]), { label: 'kitchen', similarity: MATCH_THRESHOLD })
// Unlabelled anchors are never spoken.
assert.equal(bestMatch([at(null, 0.99), at('  ', 0.99)]), null)
assert.equal(bestMatch([]), null)

console.log('placeMatch: all checks passed')
