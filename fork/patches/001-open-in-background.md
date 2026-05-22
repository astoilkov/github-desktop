# 001 — Open local repository via URL scheme (optionally in background)

## Goal

Let editor integrations (e.g. a VSCode extension that wants Desktop to stay
synced with the active workspace) point GitHub Desktop at a repository **by
local workspace path** via the `x-github-client://openLocalRepo?...` URL
scheme, and optionally do it without the app stealing focus.

Upstream's `x-github-client://openRepo/<remote-url>` action identifies the
repository by its **remote** URL and uses Desktop's repo-matching logic to
find the local clone — which is awkward for editor integrations that already
know the local path and may have multiple clones of the same remote.

The new action is keyed on the local path directly:

```
x-github-client://openLocalRepo?path=%2FUsers%2Fyou%2Frepos%2Ffoo
x-github-client://openLocalRepo?path=%2FUsers%2Fyou%2Frepos%2Ffoo&activate=false
```

- `path` (required) — absolute path to the workspace (URL-encoded).
- `activate=false` (optional) — select the repository in the UI but do not
  call `window.show()` / `window.focus()`. When set, the "Add Repository"
  popup is also suppressed for unknown paths, so editor tooling that fires
  the URL on every workspace switch never produces a popup the user didn't
  ask for.

The existing `openrepo` (remote-URL) action is untouched.

## Upstream link

- Issue: <https://github.com/desktop/desktop/issues/22150>
- Status: filed as enhancement, not on upstream's roadmap.

## Touched files

- `app/src/lib/parse-app-url.ts` — new `IOpenLocalRepositoryFromURLAction`
  interface added to the `URLActionType` union; new `openlocalrepo` branch in
  `parseAppURL` that reads `path` and `activate` from the query string.
- `app/src/main-process/main.ts` — `handleAppURL`.
- `app/src/main-process/app-window.ts` — `AppWindow.sendURLAction`.
- `app/src/ui/dispatcher/dispatcher.ts` — new `openLocalRepositoryFromUrl`
  method; `dispatchURLAction` routes the new action to it; the import list
  picks up `IOpenLocalRepositoryFromURLAction`.

## Change summary

### `parse-app-url.ts`

- Add `IOpenLocalRepositoryFromURLAction { name, path, openInBackground }`
  and include it in the `URLActionType` union.
- In `parseAppURL`, BEFORE the "bail if no pathname" check, handle the
  `openlocalrepo` host: require a non-empty `path` query param, set
  `openInBackground: activate === 'false'`. The check has to be above the
  pathname bailout because the new action carries all its data in the query
  string and has no pathname.

### `main-process/main.ts`

- In `handleAppURL`, compute
  `background = action.name === 'open-local-repository-from-url' && action.openInBackground`
  before the `onDidLoad` callback, and gate the `window.focus()` call on
  `!background`. The comment about issue #973 stays with the `focus()` call.

### `main-process/app-window.ts`

- In `sendURLAction`, compute the same `background` flag and gate
  `this.show()` on `!background`. The IPC send to the renderer stays
  unconditional — only the activation is suppressed.

### `ui/dispatcher/dispatcher.ts`

- Add `openLocalRepositoryFromUrl(action)`. It mirrors the existing CLI
  `open-repository` flow: resolve `getRepositoryType(path)` to the repo's
  `topLevelWorkingDirectory` (falling back to the raw path), look it up with
  `matchExistingRepository`, then either `selectRepository(existing)` or
  show the `AddRepository` popup. Skip the popup when `openInBackground` is
  true.
- Add the new action to the `dispatchURLAction` switch.

## Caveats

- **Cold start** is not patched. If Desktop is *not* running when a
  background URL arrives, the first-load path in `main.ts`
  (`window.onDidLoad(() => window.show())`) will still show the window once
  the renderer is ready. The patch is targeted at the hot-app nudge case.
  If cold-launch-to-background is also needed, gate that `window.show()` on
  the same flag — but be aware Electron may still bounce the dock icon on
  macOS unless the app is also configured with `LSUIElement` or
  `app.dock.hide()`.
- **Other channels** (`--cli-open`, `open-file`) still activate. Those flow
  through `handleCLIAction` and the `second-instance` handler, which are
  deliberately left untouched.
- **Unknown paths in background** are silently dropped (no popup) so editor
  tooling can fire the URL on every workspace switch without nagging the
  user. If the user wants to add the repo, they can drop `activate=false`
  and the popup returns.

## Verify

With Desktop running and not in focus, and a known repository at
`/Users/you/repos/desktop`:

```sh
open -g "x-github-client://openLocalRepo?path=%2FUsers%2Fyou%2Frepos%2Fdesktop&activate=false"
```

Expected: the previously-active app stays focused; Desktop's dock icon does
not bounce; if you switch to Desktop manually, the linked repo is now
selected.

Without `?activate=false`:

```sh
open "x-github-client://openLocalRepo?path=%2FUsers%2Fyou%2Frepos%2Fdesktop"
```

Expected: Desktop activates and selects the repo (regression check on the
normal foreground path).

Unknown path with `activate=false`:

```sh
open -g "x-github-client://openLocalRepo?path=%2Ftmp%2Fnot-a-repo&activate=false"
```

Expected: no window comes forward, no popup appears (silent drop). The same
URL without `activate=false` should produce the "Add Repository" popup.
