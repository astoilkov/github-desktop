# 002 — Show on-disk folder name instead of GitHub repo name

## Goal

In the current-repository toolbar button and in each entry of the repository
switcher popup, display the **on-disk folder name** of the working tree
instead of the GitHub repository name.

Upstream resolves `Repository.name` as
`(gitHubRepository && gitHubRepository.name) || basename(path)` — so when a
local checkout is linked to a GitHub repo, the UI always shows the GitHub
name, even if the user cloned (or renamed) the folder to something
different. This fork's owner manages many forks/worktrees where the folder
name is the meaningful identifier and the GitHub name is repetitive or
misleading. Switching the displayed label to `basename(repository.path)`
makes the UI reflect what's actually on disk.

User-set aliases (`repository.alias`) still take precedence — only the
fallback changes (from `repository.name` to `Path.basename(repository.path)`).

## Upstream link

- None.

## Touched files

- `app/src/ui/app.tsx` — `renderRepositoryToolbarButton` in the `App`
  component.
- `app/src/ui/repositories-list/repository-list-item.tsx` — `render` in
  `RepositoryListItem` (and a new `path` import at the top).

## Change summary

### `app.tsx`

- In `renderRepositoryToolbarButton`, replace `alias ?? repository.name`
  with `alias ?? Path.basename(repository.path)` when computing the toolbar
  button `title`. `Path` is already imported at the top of the file.

### `repository-list-item.tsx`

- Add `import * as Path from 'path'` at the top of the file.
- In `render`, replace `alias ?? repository.name` with
  `alias ?? Path.basename(repository.path)` in the `HighlightText`'s `text`
  prop, so each row in the switcher list shows the folder name.

## Caveats

- The per-row **tooltip** (`renderTooltip`) is deliberately left alone — it
  still shows the GitHub `fullName` plus the full path on hover, which is
  useful when the folder name alone is ambiguous.
- The disambiguation `prefix` (`${gitHubRepo.owner.login}/`) in the list
  item is also untouched. It is keyed off GitHub `name` collisions, not
  folder-name collisions, so it can still appear in front of a folder name
  for repos that happen to share a GitHub name. Acceptable for now.
- `CloningRepository` is handled by the same code path — its `path` is the
  destination folder, so `Path.basename(path)` returns a reasonable label
  for in-progress clones.
- Repos at a filesystem root (where `Path.basename` returns `""`) are not
  specially handled here. Upstream's private `getBaseName` in
  `models/repository.ts` falls back to the full path in that case; this
  patch does not replicate that fallback because root-mounted repositories
  are vanishingly rare in practice. If this ever bites, export `getBaseName`
  from the model and call that here.

## Verify

With at least one repository whose **folder name on disk differs from its
GitHub repository name** (e.g. cloned with `git clone <url> custom-folder`):

1. Open GitHub Desktop and switch to that repository.
2. Confirm the toolbar's current-repository button shows the **folder
   name** (`custom-folder`), not the GitHub name.
3. Click the toolbar button to open the repository switcher popup.
4. Confirm the entry for that repository also shows the **folder name** in
   the list.
5. Hover the entry — the tooltip should still show the full GitHub
   `owner/name` and the full path (regression check on the deliberately
   untouched tooltip).
6. Right-click the entry → **Create Alias**, set an alias. Confirm the
   alias replaces the folder name in both the toolbar and the list row
   (regression check on the alias short-circuit).
