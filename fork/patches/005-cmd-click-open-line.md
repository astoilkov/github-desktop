# 005 — Cmd+click a diff line to open it in the external editor

## Goal

Make ⌘+click (Ctrl+click off macOS) on any line in the diff open that exact line
in the user's configured external editor. Upstream can only open a *file* in the
editor (via the file-list context menu), so jumping from a diff line to the same
line in the editor means opening the file and then manually scrolling/searching
for the spot you were just looking at. This patch closes that gap: the click
resolves the line's number in the current on-disk file and hands it to the
editor, so you land on the line you clicked.

## Upstream link

- None.

## Touched files

- `app/src/lib/editors/line-jump.ts` (new) — `editorURLSchemes` map and
  `getEditorLineJumpURL`.
- `app/src/lib/editors/index.ts` — barrel re-export of `./line-jump`.
- `app/src/lib/stores/app-store.ts` — `_openInExternalEditor` in `AppStore`
  (plus the `getEditorLineJumpURL` import from `../editors`).
- `app/src/ui/dispatcher/dispatcher.ts` — `openInExternalEditor` in `Dispatcher`.
- `app/src/ui/diff/side-by-side-diff-row.tsx` — new `onOpenLineInExternalEditor`
  prop on `ISideBySideDiffRowProps`; new `onContentMouseDown` and
  `getCurrentFileLineNumber` in `SideBySideDiffRow`; the `.content` div in
  `renderContent` gains the `onMouseDown` handler.
- `app/src/ui/diff/side-by-side-diff.tsx` — new `onOpenInExternalEditor` prop on
  `ISideBySideDiffProps`, forwarded to `SideBySideDiffRow` in the row renderer.
- `app/src/ui/diff/index.tsx` — new `onOpenInExternalEditor` prop on
  `IDiffProps`; new `onOpenLineInExternalEditor` in `Diff`; `renderTextDiff`
  wires it to `SideBySideDiff` (plus a new `path` import).
- `app/src/ui/diff/seamless-diff-switcher.tsx` — new `onOpenInExternalEditor`
  prop on `ISeamlessDiffSwitcherProps`, destructured from `propSnapshot` and
  passed to `Diff` in `render`.
- `app/src/ui/changes/changes.tsx` — new `onOpenInExternalEditor` in `Changes`,
  passed to `SeamlessDiffSwitcher`.
- `app/src/ui/history/selected-commits.tsx` — new `onOpenLineInExternalEditor`
  in `SelectedCommits`, passed to `SeamlessDiffSwitcher`.

## Change summary

The feature is one new capability (launch an editor at a line) plus the prop
plumbing to carry a clicked line number from the diff row down to the dispatcher.

- `line-jump.ts` (new): maps an editor's display name to the custom URL scheme
  that can open a file at a line, and builds a `scheme://file/<path>:<line>:1`
  URL. Covers the VS Code family (VS Code, Insiders, VSCodium), Cursor, Windsurf
  and Zed. Returns `null` for any editor without a known scheme, which is the
  signal to fall back to a plain file-open. Normalizes Windows paths to a
  slash-prefixed POSIX form and `encodeURI`s the path.

  A URL scheme is used rather than CLI arguments because on macOS the app
  launches editors with `open -a <bundle>`, which cannot forward a line number;
  the schemes also work regardless of whether the editor is already running, and
  work uniformly across platforms.

- `app-store.ts` — `_openInExternalEditor`: takes an optional `lineNumber`. When
  one is given (and a non-custom editor resolved), it tries
  `getEditorLineJumpURL` and opens the result with `shell.openExternal`. If the
  editor has no scheme, or the URL fails to open, it falls through to the
  existing `launchExternalEditor(fullPath, match)` — so an unsupported editor
  still opens the file, just without jumping.

- `dispatcher.ts` — `openInExternalEditor`: forwards a new optional `lineNumber`
  through to `_openInExternalEditor`. Existing callers (file-list context menus,
  etc.) pass no line and are unaffected.

- `side-by-side-diff-row.tsx`: `onContentMouseDown` fires on the line's content
  div, gates on the cmd/ctrl modifier (`__DARWIN__ ? metaKey && !ctrlKey :
  ctrlKey`), and calls `preventDefault()` / `stopPropagation()` so the click
  neither starts a text selection nor reaches the diff's container-level mouse
  handling. `getCurrentFileLineNumber` resolves the row to a line in the
  *current on-disk file* — the after-side number for added/context/modified rows
  — since that is the file the editor opens. Deleted rows fall back to their
  before-side number as a best-effort target, and hunk headers return `null`
  (no-op).

- `side-by-side-diff.tsx`, `index.tsx`, `seamless-diff-switcher.tsx`: pure
  plumbing. `Diff` is the level that owns both `repository` and `file`, so it is
  where `Path.join(repository.path, file.path)` builds the absolute path; below
  it the callback carries only a line number, above it a `(fullPath, lineNumber)`
  pair. Every new prop is optional, so any other `Diff`/`SeamlessDiffSwitcher`
  render site that does not opt in simply has the feature inert.

- `changes.tsx` / `selected-commits.tsx`: the two diff hosts. Both already hold a
  `dispatcher`, so each wires the callback straight to
  `dispatcher.openInExternalEditor(fullPath, lineNumber)` — no new plumbing
  through `app.tsx`. This is what enables the feature in both the **Changes**
  view and the **History** commit-diff view.

## Verify

1. `yarn build:dev && yarn start` (or run the packaged dev build).
2. Make sure the configured external editor (Settings → Integrations) is one of
   VS Code / VS Code Insiders / VSCodium / Cursor / Windsurf / Zed.
3. In the **Changes** tab, select a modified file and ⌘+click a line in the
   diff — the editor should focus and land on **that** line of the file (not
   just the top of the file). Check an added line, an unchanged context line and
   a modified line.
4. Do the same in the **History** tab: select a commit, select a file, ⌘+click a
   line — the editor opens the current working-copy file at that line.
5. Verify a plain (unmodified) click still behaves normally: dragging across the
   line content still selects text, and clicking the gutter still toggles line
   inclusion.
6. Switch the editor to one with no known scheme (e.g. a JetBrains IDE or Sublime
   Text) and ⌘+click a line — the file should still open, just without jumping to
   the line (graceful fallback, no error dialog).

## Caveats

- **Deleted lines are best-effort.** A deleted line no longer exists in the
  on-disk file, so its before-side number is used; the editor may land near, but
  not exactly on, the corresponding spot.
- **Historical commits open the current file.** The editor always opens the
  working-copy file, so ⌘+clicking a line in an old commit's diff jumps to that
  line number in the file *as it is now* — which may have drifted if the file
  changed after that commit.
- **Custom editors are not supported** for line jumping. The `useCustomEditor`
  branch of `_openInExternalEditor` is untouched and always opens the file
  without a line, since a custom integration has no known URL scheme. (The
  `%TARGET_PATH%` templating in `custom-integration.ts` could be extended with a
  line placeholder later.)
- **No visual affordance.** There is no cursor or hover hint that a line is
  ⌘-clickable; the gesture works but is not discoverable.
