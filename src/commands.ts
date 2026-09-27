// Turns what the speech recogniser heard into an action. Phase 6 made "hold" a
// hold-and-speak gesture (docs/decisions.md). No native imports, so it runs under
// plain `node` (see commands.test.ts).

export type Command =
  | { kind: 'describe' }
  | { kind: 'read' }
  | { kind: 'save'; label: string }
  | { kind: 'whereami' }
  | { kind: 'showLogs' }
  | { kind: 'hideLogs' }
  | { kind: 'unknown'; heard: string }

/** Lowercase, straight apostrophes, no punctuation, no wake word or politeness. */
export function normalise(heard: string): string {
  return heard
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |okay )?lumina /, '')
    .replace(/^please /, '')
    .replace(/ please$/, '')
    .trim()
}

// "save this as the library door", "remember this place as my desk", "call this lab 2"
const SAVE =
  /^(?:save|remember|mark|call|name)(?: this| here| it)?(?: place| spot| location)?(?: as| called)? (.+)$/
const WHERE = /^(?:where am i|where is this|what place is this|which place is this|where are we)$/
const DESCRIBE =
  /^(?:what's|what is|whats) (?:around|in front of|near) (?:me|us)$|^(?:describe(?: this| the scene| it)?|what do you see|look(?: around)?|what's here|what is here)$/
const READ = /^read(?: this| that| it| text| the text| the sign)?$/
// The on-screen debug overlay, for demos to sighted people (the viva). Blind users never
// need it, so it is off by default in release builds.
const SHOW_LOGS = /^(?:show|turn on|open) (?:the )?(?:logs?|debug)(?: screen| overlay)?$/
const HIDE_LOGS = /^(?:hide|turn off|close) (?:the )?(?:logs?|debug)(?: screen| overlay)?$/

export function parseCommand(heard: string): Command {
  const said = normalise(heard)
  // Order matters: "where am i" must not be read as a save, and a save label may
  // contain any word, so the fixed phrases are checked first.
  if (WHERE.test(said)) return { kind: 'whereami' }
  if (DESCRIBE.test(said)) return { kind: 'describe' }
  if (READ.test(said)) return { kind: 'read' }
  if (SHOW_LOGS.test(said)) return { kind: 'showLogs' }
  if (HIDE_LOGS.test(said)) return { kind: 'hideLogs' }
  const save = SAVE.exec(said)
  if (save != null) {
    const label = save[1].trim()
    // "save this" with nothing after it has no name to remember.
    if (label.length > 0 && !/^(this|here|it|place|spot)$/.test(label)) return { kind: 'save', label }
  }
  return { kind: 'unknown', heard: said }
}
