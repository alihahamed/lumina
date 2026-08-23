# Bugs

A start-to-finish trail per bug, so anyone can pick it up cold. Newest first.

**Nothing logged yet** — no shipped code has been debugged. The first real bug goes here.

Build-time corrections made while scaffolding (wrong worklets package, `Frame` type
clash) are in `decisions.md`, not here: they were choices made before anything ran,
not defects in working code.

---

## Format

Copy this. Fill in every heading — the value of this file is in **Root cause**, which
is the part people skip.

```markdown
## YYYY-MM-DD — One-line summary

**Status:** open | fixed
**Files:** the ones actually changed

### Symptom
What was observed. Device, Android version, and the exact steps to reproduce.
Paste the real error or logcat line, not a paraphrase.

### Root cause
Why it actually happened. Not "the value was null" — *why* it was null, and which
function was responsible for it not being.

### Fix
What changed and where. If it was fixed in a shared function rather than at the call
site, say so and list the other callers that were also broken.

### How we know it's fixed
The check that fails if this regresses. Add it to `test-checklist.md` if it needs a
human or a device.

### Anything still open
Related things noticed but not fixed. Better here than forgotten.
```

## Before you write an entry

Fix the root cause, not the symptom. Grep every caller of the function you are about
to change — one guard in the shared function is a smaller diff than a guard in each
caller, and patching only the path you noticed leaves the sibling paths broken.

If the fix was a deliberate stopgap, mark it with a `ponytail:` comment at the site
naming the ceiling and the upgrade path, and say so in the entry.
