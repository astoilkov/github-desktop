# 010 — Copy the SHAs of multiple commits

## Goal

When you select more than one commit in the History tab, the context menu has
a "Copy N SHAs" item. It copies the full SHAs, separated by spaces, so you can
paste them into a git command or give them to another tool. Upstream shows
"Copy SHA" only when you select one commit.

## Upstream link

- None

## Touched files

- `app/src/ui/history/commit-list.tsx` — `getContextMenuMultipleCommits` and
  the new `getSelectedSHAsInListOrder` in `CommitList`.

## Change summary

- `getContextMenuMultipleCommits` — add a separator and a "Copy N SHAs" item
  after the reorder item.
- `getSelectedSHAsInListOrder` — return the selected SHAs in the order of the
  list (newest first), not in the order that you selected them, joined with
  spaces.

## Verify

1. `yarn build:dev && yarn start` and open a repository.
2. History tab: select three commits with Cmd-click (Ctrl-click on Windows),
   in a random order.
3. Right-click one of them and click "Copy 3 SHAs".
4. Paste: three full SHAs on one line, separated by spaces, newest first.
