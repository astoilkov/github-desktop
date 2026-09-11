# 008 — Copy commit location

## Goal

In the History tab, add a button after the copy SHA button in the commit
summary. It copies the repository path, the full SHA, and the selected file's
path, so another tool (for example an AI agent) can find the commit and the
file. The repository path uses `~` for the home directory, so the text does
not show the user name and stays short.

## Upstream link

- None

## Touched files

- `app/src/ui/copy-button.tsx` — `ICopyButtonProps` and `renderSymbol` in
  `CopyButton`.
- `app/src/ui/history/expandable-commit-summary.tsx` —
  `IExpandableCommitSummaryProps`, `renderCommitRef`, and the new
  `getCommitLocation` / `replaceHomeDirWithTilde` functions at the end of the
  file.
- `app/src/ui/history/selected-commits.tsx` — `renderCommitSummary`.

## Change summary

- `copy-button.tsx` — new optional `symbol` prop, so a caller can set the
  icon. The default is still `copy`; after a click the icon is still `check`.
- `expandable-commit-summary.tsx` — new `selectedFile` prop. `renderCommitRef`
  renders a second `CopyButton` with the `location` octicon. Its content comes
  from `getCommitLocation`:

  ```
  Repository: ~/repos/github-desktop
  Commit: <full SHA>
  File: app/src/ui/history/expandable-commit-summary.tsx
  ```

  The `File:` line is left out when no file is selected. Paths outside the
  home directory are copied as they are.
- `selected-commits.tsx` — pass `selectedFile` to `ExpandableCommitSummary`.

No style changes: the existing `.commit-ref .copy-button` rule in
`_expandable-commit-summary.scss` also styles the new button.

## Verify

1. `yarn build:dev && yarn start`, open a repository, open the History tab,
   and select a commit and a file.
2. A map pin icon shows after the copy SHA icon. Its tooltip is "Copy the
   repository path, SHA, and file path".
3. Click it and paste: the three lines above, with `~` at the start of the
   repository path and the path of the selected file.
4. Select a commit with no files (or clear the file selection): the pasted
   text has no `File:` line.
