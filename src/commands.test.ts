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

// --- silence
for (const s of ['Stop.', 'be quiet', 'stop talking', 'Lumina, stop']) assert.equal(kind(s), 'quiet', s)
assert.equal(kind('stop the music'), 'unknown')

// --- routes
{
  const c = (s: string) => parseCommand(s)
  assert.deepEqual(c('Start route to the library'), { kind: 'routeStart', label: 'the library' })
  assert.deepEqual(c('record a path to lab 2'), { kind: 'routeStart', label: 'lab 2' })
  assert.deepEqual(c('Take me to the library.'), { kind: 'routeGo', label: 'the library' })
  assert.deepEqual(c('guide me back to my desk'), { kind: 'routeGo', label: 'my desk' })
  for (const s of ['end route', 'Stop the route', 'finish recording', 'cancel guidance']) assert.equal(kind(s), 'routeEnd', s)
  // A place is still a place.
  assert.equal(kind('save this as the route'), 'save')
}

// --- debug overlay toggle
for (const s of ['show logs', 'Show the debug screen', 'turn on debug']) assert.equal(kind(s), 'showLogs', s)
for (const s of ['hide logs', 'turn off the debug overlay', 'close logs']) assert.equal(kind(s), 'hideLogs', s)

// --- measurement commands (src/measure.ts), for the evaluation only
for (const s of ['start measuring', 'Begin measurement', 'start benchmark']) assert.equal(kind(s), 'measureStart', s)
for (const s of ['stop measuring', 'finish the measurement', 'end benchmark']) assert.equal(kind(s), 'measureStop', s)
for (const s of ['log distance', 'record the distance', 'measure depth']) assert.equal(kind(s), 'logDistance', s)
assert.deepEqual(parseCommand('Check place library door'), { kind: 'checkPlace', truth: 'library door' })
assert.deepEqual(parseCommand('test location lab 2'), { kind: 'checkPlace', truth: 'lab 2' })
for (const s of ['check place unknown', 'check place not saved', 'test place none'])
  assert.deepEqual(parseCommand(s), { kind: 'checkPlace', truth: null }, s)
assert.equal(kind('check place'), 'unknown', 'no truth given')

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
