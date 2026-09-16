# 008 — Copy commit location

## Goal

Add a button that copies the location of a change, so another tool (for
example an AI agent) can find the commit and the file.

- In the History tab, the button is after the copy SHA button in the commit
  summary. It copies the repository path, the full SHA, and the selected
  file's path.
- In the Changes tab, the button is in the diff header, before the diff
  options. It copies the repository path and the file's path, and it tells
  that the changes are not committed.

The repository path uses `~` for the home directory, so the text does not show
the user name and stays short.

## Upstream link

- None

## Touched files

- `app/src/lib/get-location-text.ts` — new file with `getLocationText` and
  `replaceHomeDirWithTilde`.
- `app/src/ui/copy-button.tsx` — `ICopyButtonProps` and `renderSymbol` in
  `CopyButton`.
- `app/src/ui/history/expandable-commit-summary.tsx` —
  `IExpandableCommitSummaryProps` and `renderCommitRef`.
- `app/src/ui/history/selected-commits.tsx` — `renderCommitSummary`.
- `app/src/ui/diff/diff-header.tsx` — `IDiffHeaderProps`, `render`, and the new
  `renderCopyLocationButton` in `DiffHeader`.
- `app/src/ui/changes/changes.tsx` — `render` in `Changes`.
- `app/styles/ui/_diff.scss` — `.copy-button` rule inside `.header`.

## Change summary

- `get-location-text.ts` — `getLocationText(repository, sha, filePath)` makes
  the text to copy:

  ```
  Repository: ~/repos/github-desktop
  Commit: <full SHA>
  File: app/src/ui/history/expandable-commit-summary.tsx
  ```

  When `sha` is `null`, the second line is `Commit: uncommitted changes`. When
  `filePath` is `null`, the `File:` line is left out. Paths outside the home
  directory are copied as they are.
- `copy-button.tsx` — new optional `symbol` prop, so a caller can set the
  icon. The default is still `copy`; after a click the icon is still `check`.
- `expandable-commit-summary.tsx` — new `selectedFile` prop. `renderCommitRef`
  renders a second `CopyButton` with the `location` octicon and the text from
  `getLocationText`.
- `selected-commits.tsx` — pass `selectedFile` to `ExpandableCommitSummary`.
- `diff-header.tsx` — new optional `locationText` prop. When it is set,
  `renderCopyLocationButton` renders a `CopyButton` with the `location`
  octicon. The History tab does not set it, because the commit summary already
  has the button.
- `changes.tsx` — pass `getLocationText(repository, null, file.path)` to
  `DiffHeader`.
- `_diff.scss` — remove the default button styles from `.copy-button` in the
  diff header, the same as `.commit-ref .copy-button` in
  `_expandable-commit-summary.scss`.

## Verify

1. `yarn build:dev && yarn start` and open a repository.
2. History tab: select a commit and a file. A map pin icon shows after the
   copy SHA icon. Click it and paste: the three lines above, with `~` at the
   start of the repository path and the path of the selected file.
3. History tab: select a commit with no files (or clear the file selection).
   The pasted text has no `File:` line.
4. Changes tab: change a file and select it. A map pin icon shows in the diff
   header, before the diff options icon. Click it and paste: the
   `Repository:` line, `Commit: uncommitted changes`, and the `File:` line.
