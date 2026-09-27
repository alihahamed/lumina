// Run with: node src/text.test.ts
import assert from 'node:assert'
import { firstSentences } from './text.ts'

assert.equal(firstSentences('A door ahead. A chair on the left. A plant.', 2), 'A door ahead. A chair on the left.')
// Cut off by the timeout mid-sentence: the fragment is not spoken.
assert.equal(firstSentences('Stairs ahead! Be careful near the rai', 2), 'Stairs ahead!')
// Model output often has newlines and double spaces.
assert.equal(firstSentences('  A   hallway.\n\nA door\nahead.  ', 2), 'A hallway. A door ahead.')
// No punctuation at all: keep it rather than say nothing.
assert.equal(firstSentences('a table with a laptop', 2), 'a table with a laptop')
assert.equal(firstSentences('', 2), '')
// Fewer sentences than asked for.
assert.equal(firstSentences('Only one.', 2), 'Only one.')

console.log('text: all checks passed')
