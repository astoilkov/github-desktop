# 004 — Skip the Add Local Repository dialog for existing repos

## Goal

When a single folder is opened in the app and that folder is already a valid
Git repository, add and open it directly instead of first showing the "Add
Local Repository" dialog. This applies to every single-folder entry point:
dragging a folder onto the window, the `github .` CLI command, and the
`x-github-desktop://openlocalrepo` URL scheme. Upstream always routes these
through the dialog so the user can initialize a non-Git folder; but when the
folder is already a repository the dialog adds nothing and just costs an extra
confirmation. This patch keeps the dialog only for the case it actually serves
— a folder that is not yet a Git repository.

## Upstream link

- None.

## Touched files

- `app/src/ui/app.tsx` — `handleDragAndDrop` in the `App` component.
- `app/src/ui/dispatcher/dispatcher.ts` — `dispatchCLIAction` (the
  `open-repository` branch, used by `github .`) and `openLocalRepositoryFromUrl`
  (the `openlocalrepo` URL scheme handler added by patch 001).

## Change summary

All three sites shared the same shape: resolve `getRepositoryType`, collapse it
to a path, and `showPopup({ type: PopupType.AddRepository, path })` for any
untracked path. Each now keeps the full `repositoryType` result, derives `path`
from it, and falls back to `{ kind: 'missing' }` on error (so failures still
route to the dialog). The untracked branch becomes: if `repositoryType.kind ===
'regular'` (already a Git repo), call `addRepositories([path])`, record the
analytics event, and select the added repository — skipping the dialog;
otherwise show the `AddRepository` popup so the folder can be initialized.

- `app/src/ui/app.tsx`: applied in the single-path branch of
  `handleDragAndDrop`.
- `app/src/ui/dispatcher/dispatcher.ts` — `dispatchCLIAction`: applied in the
  `open-repository` branch (the `github .` path).
- `app/src/ui/dispatcher/dispatcher.ts` — `openLocalRepositoryFromUrl`: applied
  inside the existing `!action.openInBackground` guard, so silent/background
  activations still do nothing for unknown repos while foreground activations
  add+select a real repo and only show the dialog for a non-Git folder.

## Verify

1. `yarn build:dev && yarn start` (or run the packaged dev build).
2. From a Git repo folder, run `github .` in the terminal — the repo should be
   added and selected immediately, with no "Add Local Repository" dialog.
3. Run `github .` from a folder that is NOT a Git repository — the dialog
   should still appear so the folder can be initialized/created.
4. Drag a Git-repo folder onto the app window — added and selected immediately,
   no dialog. Drag a non-Git folder — dialog still appears.
5. Open an existing repo via the `x-github-desktop://openlocalrepo?path=…` URL
   scheme (foreground) — added and selected with no dialog; a background/silent
   activation of an unknown repo should still do nothing.
6. Open a folder already tracked (any path above) — it should just be selected
   (unchanged behavior).

## Caveats

- The **File → Add Local Repository…** menu item and the "+" button in the
  repository list intentionally open the dialog with an empty path; those are
  not touched by this patch since there is no folder to add directly.
- Multi-folder drops are unchanged (upstream already bulk-adds them without the
  dialog).
