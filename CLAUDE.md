@AGENTS.md

# Documentation protocol

This is a four-person team project. Code that only makes sense to whoever wrote it
is a liability. After writing or changing code, log it — but **only in the file that
matches the situation.**

## The rule

Pick the file that fits. Usually that is **exactly one**. Never write to a file just
because it exists, and never repeat the same content across files.

| Situation | File | What goes in |
|---|---|---|
| A choice was made between real alternatives | `docs/decisions.md` | Why this, what was rejected, what would change our mind |
| Execution paths changed — new file, entry point, or call chain | `docs/flow.md` | How control actually moves, file → function → file |
| Something new was built | `docs/feature.md` | Start-to-finish trail someone can pick up cold |
| Something broken was fixed | `docs/bug.md` | Symptom → root cause → fix → how we know it's fixed |
| Logic needs verifying by hand or on a device | `docs/test-checklist.md` | The check, and what a pass looks like |

## Two files that are not situational

`HANDOFF.md` — **update the "Current session" section at the end of every session.**
It is what an agent with no context reads first. Stale handoff is worse than none.

`IMPLEMENTATION.md` — update when you add or remove a file, a dependency, or a
load-bearing setting. It is the map of what exists.

`STATUS.md` is the team's single page. Update it when a phase completes or an open
decision closes — not for routine work.

## When NOT to write anything

- Renames, formatting, comment tweaks, dependency bumps with no behaviour change.
- Anything already captured. Update the existing entry instead of appending a near-duplicate.
- Work in progress. Log it when it lands, not while it's half-built.

## How to write an entry

Newest first, under a dated heading. Write for a teammate who was not in the room
and does not have the conversation you had.

- **Name real things** — files, functions, model names, versions. "Improved detection"
  is worthless; `App.tsx onFrame` is not.
- **State the why, not the what.** The diff already shows what changed.
- **Record what you rejected.** The single most useful thing in `decisions.md` is
  the option that was considered and dropped, so nobody re-litigates it in week nine.
- **Be honest about shortcuts.** If something is a stopgap, say so and say what would
  replace it. Deliberate corner-cutting also gets a `ponytail:` comment at the site.

## Where the reasoning already lives

`PRD.md` section 5 holds the founding stack decisions. `docs/decisions.md` is for
everything decided *after* that. Do not duplicate PRD content — link to it.
