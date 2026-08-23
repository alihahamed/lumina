// Run with: npm test
import assert from 'node:assert'
import { COOLDOWN_MS, shouldAnnounce } from './rateLimit.ts'

const seen = new Map<string, number>()

assert.equal(shouldAnnounce('chair', 0, seen), true, 'first announcement passes')
assert.equal(shouldAnnounce('chair', 1000, seen), false, 'repeat inside cooldown is suppressed')
assert.equal(shouldAnnounce('chair', COOLDOWN_MS, seen), true, 'repeat at the cooldown boundary passes')
assert.equal(shouldAnnounce('door', COOLDOWN_MS, seen), true, 'a different key has its own cooldown')
assert.equal(shouldAnnounce('chair', COOLDOWN_MS + 1, seen), false, 'the cooldown restarts on each pass')

// A short cooldown must not leak the default.
const fast = new Map<string, number>()
assert.equal(shouldAnnounce('step', 0, fast, 100), true, 'custom cooldown: first passes')
assert.equal(shouldAnnounce('step', 50, fast, 100), false, 'custom cooldown: suppressed inside window')
assert.equal(shouldAnnounce('step', 100, fast, 100), true, 'custom cooldown: passes at boundary')

console.log('rateLimit: all checks passed')
