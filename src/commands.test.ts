// Run with: node src/commands.test.ts
import assert from 'node:assert'
import { normalise, parseCommand } from './commands.ts'

const kind = (s: string) => parseCommand(s).kind
const label = (s: string) => {
  const c = parseCommand(s)
  return c.kind === 'save' ? c.label : null
}

// --- describe
for (const s of ["What's around me?", 'what is around me', 'What’s in front of me', 'Describe', 'describe the scene', 'What do you see', 'look around'])
  assert.equal(kind(s), 'describe', s)

// --- where am i
for (const s of ['Where am I?', 'where is this', 'What place is this'])
  assert.equal(kind(s), 'whereami', s)

// --- read
for (const s of ['read', 'Read this', 'read the sign']) assert.equal(kind(s), 'read', s)

// --- save, and what gets remembered
assert.equal(label('Save this as the library door'), 'the library door')
assert.equal(label('remember this place as my desk'), 'my desk')
assert.equal(label('call this lab 2'), 'lab 2')
assert.equal(label('Save the kitchen.'), 'the kitchen')
assert.equal(label('Lumina, save this as room 204, please'), 'room 204')
// A name containing a command word is still a name.
assert.equal(label('save this as where I read'), 'where i read')

// --- nothing to remember, or not a command: never guess
assert.equal(kind('save this'), 'unknown')
assert.equal(kind('save'), 'unknown')
assert.equal(kind('turn left'), 'unknown')
assert.equal(kind(''), 'unknown')

// --- normalise
assert.equal(normalise('  Hey Lumina,  WHAT’S around me?! '), "what's around me")

console.log('commands: all checks passed')
