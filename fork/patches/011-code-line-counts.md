# 011 — Code, import, test, JSON, and comment line counts

## Goal

The commit summary shows the added and removed lines (`+N -M`) also when you
select more than one commit. Upstream shows them only for one commit. The
Changes tab shows `+N -M` for the uncommitted changes too, next to "K changed
files". When you hover the counts, a tooltip shows how many of the lines are
code, imports, tests, JSON, and comments. You can then see how much code a
change really adds.

## Upstream link

- None

## Touched files

- `app/src/lib/git/code-lines.ts` (new) — `getCodeLineCounts`,
  `getWorkingDirectoryCodeLineCounts`, `parseCodeLineCounts`,
  `createAddedFileDiff`, `isTestFile`.
- `app/src/ui/history/lines-changed.tsx` (new) — the `LinesChanged`
  component.
- `app/src/ui/history/expandable-commit-summary.tsx` — `renderMetaItems` and
  `renderLinesChanged` in `ExpandableCommitSummary`.
- `app/src/ui/changes/working-directory-lines-changed.tsx` (new) — the
  `WorkingDirectoryLinesChanged` component.
- `app/src/ui/changes/filter-changes-list.tsx` — `renderCheckBoxRow` in
  `FilterChangesList`.
- `app/styles/ui/window/_tooltips.scss` — `.tooltip.lines-changed-tooltip`.
- `app/styles/ui/changes/_changes-list.scss` —
  `.working-directory-lines-changed`.
- `app/test/unit/code-lines-test.ts` (new).

## Change summary

- `getCodeLineCounts` runs `git diff` between the same two refs as the
  changeset and gives the lines to `parseCodeLineCounts`. If the parent ref
  does not exist (a root commit), it uses the empty tree.
- `parseCodeLineCounts` puts each added and removed line into one group, in
  this order:
  - Tests: any line in a file that `isTestFile` finds, from its directory
    (`test/`, `__tests__/`, `spec/`, …) or name (`*.test.*`, `*-test.*`,
    `*_test.go`, `test_*.py`, `FooTests.swift`, …).
  - JSON: any other line in a `.json`, `.jsonc`, or `.json5` file
    (`isJsonFile`).
  - Comments: a line that is a comment for the language of its file
    extension. It follows block comments across lines, also through context
    lines.
  - Imports: a line of an import statement in a TypeScript or JavaScript,
    Rust, or Swift file (`importSyntaxByExtension`). It follows a multi-line
    `import { … } from 'x'` or `use a::{ … };` across lines, also through
    context lines. `import('x')` is not an import. Other languages have no
    imports group, so their imports are code.
  - Code: all other lines, blank lines too.
- It uses the default context, not `-U0`, because `-U0` can align a diff
  differently, and then the counts do not match `--numstat`.
- `getWorkingDirectoryCodeLineCounts` runs `git diff HEAD` (or the empty
  tree when HEAD has no commits) and adds a diff for each untracked file,
  because `git diff HEAD` does not show them. `createAddedFileDiff` makes
  that diff from the file on the disk. It skips binary files (a NUL byte in
  the first 8000 bytes, as git does) and files larger than 4 MB.
- `LinesChanged` renders the `+N -M` counts (moved out of
  `ExpandableCommitSummary.renderLinesChanged`). On the first hover it calls
  `getCounts` and shows the groups in a tooltip. It loads them again when
  `countsKey` changes. `ExpandableCommitSummary` gives the range of
  `changesetData.files[0]` (`parentCommitish..commitish`) as the key.
- `WorkingDirectoryLinesChanged` counts the groups each time the working
  directory changes, because the `+N -M` totals come from them. It renders
  `LinesChanged` to the right of the "K changed files" checkbox in
  `renderCheckBoxRow`.
- `renderMetaItems` renders `LinesChanged` for a selection of more than one
  commit too. A selection that is not contiguous has no changeset, so it
  shows no counts.
- The tooltip is dark in both themes, so its colors are `$green` and `$red`,
  not `--color-new` and `--color-deleted`.

## Verify

1. `yarn test app/test/unit/code-lines-test.ts`.
2. `yarn build:dev && yarn start` and open a repository.
3. History tab: select one commit and hover `+N -M`. The tooltip shows Code,
   Imports, Tests, JSON, and Comments. Each column adds up to `N` and `M`.
4. Shift-click to select some commits. `+N -M` shows under "Showing changes
   from K commits", with the same tooltip.
5. Changes tab: edit a file and add a new file. `+N -M` shows to the right of
   "K changed files" and includes the lines of the new file. Hover it to see
   the same tooltip.
