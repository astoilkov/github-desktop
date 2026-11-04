# 011 — Code, test, and comment line counts

## Goal

The commit summary shows the added and removed lines (`+N -M`) also when you
select more than one commit. Upstream shows them only for one commit. When you
hover the counts, a tooltip shows how many of the lines are code, tests, and
comments. You can then see how much code a change really adds.

## Upstream link

- None

## Touched files

- `app/src/lib/git/code-lines.ts` (new) — `getCodeLineCounts`,
  `parseCodeLineCounts`, `isTestFile`.
- `app/src/ui/history/lines-changed.tsx` (new) — the `LinesChanged`
  component.
- `app/src/ui/history/expandable-commit-summary.tsx` — `renderMetaItems` and
  `renderLinesChanged` in `ExpandableCommitSummary`.
- `app/styles/ui/window/_tooltips.scss` — `.tooltip.lines-changed-tooltip`.
- `app/test/unit/code-lines-test.ts` (new).

## Change summary

- `getCodeLineCounts` runs `git diff` between the same two refs as the
  changeset and gives the lines to `parseCodeLineCounts`. If the parent ref
  does not exist (a root commit), it uses the empty tree.
- `parseCodeLineCounts` puts each added and removed line into one group:
  - Tests: any line in a file that `isTestFile` finds, from its directory
    (`test/`, `__tests__/`, `spec/`, …) or name (`*.test.*`, `*-test.*`,
    `*_test.go`, `test_*.py`, `FooTests.swift`, …).
  - Comments: a line that is a comment for the language of its file
    extension. It follows block comments across lines, also through context
    lines.
  - Code: all other lines, blank lines too.
- It uses the default context, not `-U0`, because `-U0` can align a diff
  differently, and then the counts do not match `--numstat`.
- `LinesChanged` renders the `+N -M` counts (moved out of
  `ExpandableCommitSummary.renderLinesChanged`). On the first hover it
  counts the groups and shows them in a tooltip. It takes the refs from
  `changesetData.files[0]` (`parentCommitish`, `commitish`).
- `renderMetaItems` renders `LinesChanged` for a selection of more than one
  commit too. A selection that is not contiguous has no changeset, so it
  shows no counts.
- The tooltip is dark in both themes, so its colors are `$green` and `$red`,
  not `--color-new` and `--color-deleted`.

## Verify

1. `yarn test app/test/unit/code-lines-test.ts`.
2. `yarn build:dev && yarn start` and open a repository.
3. History tab: select one commit and hover `+N -M`. The tooltip shows Code,
   Tests, and Comments. Each column adds up to `N` and `M`.
4. Shift-click to select some commits. `+N -M` shows under "Showing changes
   from K commits", with the same tooltip.
