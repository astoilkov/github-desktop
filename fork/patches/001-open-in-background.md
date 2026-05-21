# 001 — Open repository in background via URL scheme

## Goal

Let editor integrations (e.g. a VSCode extension that wants Desktop to stay
synced with the active workspace) point GitHub Desktop at a repository via the
`x-github-client://openRepo/...` URL scheme **without** the app stealing focus.

The opt-in is a query-string flag on the URL:

```
x-github-client://openRepo/https://github.com/owner/repo?activate=false
```

When `activate=false` is present on an `openrepo` URL, the main process selects
the repository (and the renderer can fetch / set it active) but does **not**
call `window.show()` or `window.focus()`.

The change is intentionally scoped to the URL-scheme path. The `--cli-open`
flag and the macOS `open-file` path still activate the app; if a future use
case needs background semantics on those channels, add them as separate
patches.

## Upstream link

- Issue: <https://github.com/desktop/desktop/issues/22150>
- Status: filed as enhancement, not on upstream's roadmap.

## Touched files

- `app/src/lib/parse-app-url.ts` — `IOpenRepositoryFromURLAction` interface
  and the `openrepo` branch of `parseAppURL`.
- `app/src/main-process/main.ts` — `handleAppURL`.
- `app/src/main-process/app-window.ts` — `AppWindow.sendURLAction`.

## Change summary

### `parse-app-url.ts`

- Add a `readonly openInBackground: boolean` field to
  `IOpenRepositoryFromURLAction`.
- In the `openrepo` branch of `parseAppURL`, read `activate` from the query
  string and set `openInBackground: activate === 'false'`.

### `main-process/main.ts`

- In `handleAppURL`, compute
  `background = action.name === 'open-repository-from-url' && action.openInBackground`
  *before* the `onDidLoad` callback (so the flag is captured in the closure).
- Inside the `onDidLoad` callback, gate the `window.focus()` call on
  `!background`. Leave the comment about issue #973 with the `focus()` call.

### `main-process/app-window.ts`

- In `sendURLAction(action)`, compute the same `background` flag from the
  action and gate `this.show()` on `!background`. The IPC send to the
  renderer remains unconditional — only the activation is suppressed.

## Caveats

- **Cold start** is not patched. If Desktop is *not* running when a background
  URL arrives, the first-load path in `main.ts` (`window.onDidLoad(() => window.show())`)
  will still show the window once the renderer is ready. The patch is targeted
  at the hot-app nudge case the linked issue describes. If you need
  cold-launch-to-background too, gate that `window.show()` on the same flag,
  but be aware Electron may still bounce the dock icon on macOS unless the
  app is also configured with `LSUIElement` or `app.dock.hide()`.
- **Other channels** (`--cli-open`, `open-file`) still activate. Those flow
  through `handleCLIAction` and the `second-instance` handler, which are
  deliberately left untouched.

## Verify

With Desktop running and not in focus:

```sh
open -g "x-github-client://openRepo/https://github.com/desktop/desktop?activate=false"
```

Expected: the previously-active app stays focused; Desktop's dock icon does
not bounce; if you switch to Desktop manually, the linked repo is now
selected. Without `?activate=false` (or with `?activate=true`), Desktop
should activate as before — that's the regression check.
