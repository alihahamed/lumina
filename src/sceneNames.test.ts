// Run with: node src/sceneNames.test.ts
import assert from 'node:assert'
import { ADE20K } from './ade20kLabels.ts'
import { nameAhead } from './sceneNames.ts'

const W = 30
const H = 30
const map = (f: (x: number, y: number) => number) => {
  const a = new Int32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y)
  return a
}
// Centre region: columns 10..19, rows 9..26 (10 x 18 = 180 pixels).
const inCentre = (x: number, y: number) => x >= 10 && x < 20 && y >= 9 && y < 27

// A wall filling the view.
assert.equal(nameAhead(map(() => ADE20K.WALL), W, H), 'wall')

// A door in the middle of a wall: the door wins even though wall is the majority.
assert.equal(nameAhead(map((x, y) => (inCentre(x, y) && x < 14 ? ADE20K.DOOR : ADE20K.WALL)), W, H), 'door')

// Stairs win over a door, and need less area (a hazard).
assert.equal(
  nameAhead(map((x, y) => (inCentre(x, y) && y >= 24 ? ADE20K.STAIRS : inCentre(x, y) ? ADE20K.DOOR : ADE20K.WALL)), W, H),
  'stairs',
)

// Things only at the edges of the frame do not count: that is not "ahead".
assert.equal(nameAhead(map((x) => (x < 10 ? ADE20K.DOOR : ADE20K.FLOOR)), W, H), null)

// Open floor ahead: nothing to name, say nothing rather than guess.
assert.equal(nameAhead(map(() => ADE20K.FLOOR), W, H), null)

// A drinking glass is not a glass door.
assert.equal(nameAhead(map(() => ADE20K.GLASS), W, H), null)

// Wall under its share (40%) with no landmark: no name.
assert.equal(nameAhead(map((x, y) => (inCentre(x, y) && y < 14 ? ADE20K.WALL : ADE20K.FLOOR)), W, H), null)

console.log('sceneNames: all checks passed')
