# /save-patch

Based on the current conversation, either **update an existing patch** in
`fork/patches/` or **create a new one**, following the format documented in
`fork/patches/README.md`. Captures both the human-readable `.md` (intent) and
the mechanical `.patch` (diff).

## Preconditions

Verify and stop with a clear message if any fails:

- `fork/patches/README.md` exists. Read it first — its "`.md` structure"
  section defines the required sections and is authoritative.
- There's an actual change to capture: uncommitted diff (`git status
  --porcelain` non-empty) or the user names a commit to document.
- The conversation has enough context to ground `Goal` and `Verify` in
  something the user actually said or did. If not, ask — never invent
  rationale.

## Steps

1. **Inspect the change.** `git diff` (+ `--staged`) for uncommitted work, or
   `git show <ref>` for a committed reference. Identify the touched files and
   the symbols changed inside each (function / interface / section anchor).

2. **List existing patches.** `ls fork/patches/*.md` sorted numerically. Read
   each one's `Touched files` section so you can compare overlap.

3. **Decide: new patch or update?** Propose ONE to the user, with reasoning,
   and wait for confirmation:

   - **Update** when the current change touches the same files + symbols as
     an existing patch AND the conversation framed this as a refinement
     ("also handle X", "fix the typo", "extend to cover Y").
   - **New** when the change is an independent concern, even if files
     overlap.

   If ambiguous, ask before writing.

4. **For a new patch:**
   - Pick `NNN` = (max existing + 1), zero-padded to 3 digits.
   - Pick a short kebab-case slug from the conversation's framing. Confirm
     it with the user before writing.
   - Create `fork/patches/NNN-slug.md` with **every required section** in
     the order the README mandates:
     - `## Goal` — one paragraph from the conversation's problem framing.
     - `## Upstream link` — any issue / PR mentioned. If none, write
       `- None`.
     - `## Touched files` — bullet per file with the named symbol inside.
       Anchor by name, not line number.
     - `## Change summary` — per file, the *semantic* change in one or
       two sentences. Don't paste the diff.
     - `## Verify` — a concrete smoke test (command / URL / observable)
       drawn from how the change was demonstrated.
     - Optional `## Caveats` — gotchas, deliberate non-changes, follow-ups.

5. **For an update:**
   - Open the existing `NNN-slug.md` and update only the sections that
     changed. Preserve the existing `Goal` unless scope has broadened.
   - If the slug no longer fits, ask before renaming both files.

6. **Regenerate the `.patch`:**

   ```sh
   git diff <touched files> > fork/patches/NNN-slug.patch
   ```

   For a committed reference, use `git diff <ref>^..<ref> -- <touched files>`.

7. **Do not commit. Do not stage.** Print:
   - Created or updated, which patch.
   - Paths of both files.
   - The `Verify` section verbatim so the user remembers what to test.

## Rules

- The `.md` is the source of truth for intent; the `.patch` is the source
  of truth for mechanics. Both must be present and in sync after this runs.
- Never write a `Goal` or `Verify` you can't ground in the conversation.
- Never commit or stage — the user reviews and chooses what to include.
- If `fork/patches/` doesn't exist, stop and tell the user to set it up
  with a `README.md` documenting the format. Don't bootstrap silently —
  the structure is fork-specific.
