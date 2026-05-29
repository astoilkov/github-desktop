# 003 — Self-signed dev codesigning + `yarn deploy:local`

## Goal

Make local dev iteration on macOS feel like using a real installed app.
Upstream's dev build signs the `.app` with `-` (ad-hoc) so the signature
changes on every rebuild — macOS treats each new build as a brand-new app
and re-prompts the firewall ("Do you want the application to accept
incoming network connections?") and other Gatekeeper / keychain prompts.
This patch lets a developer sign dev builds with a stable self-signed
keychain identity so those prompts fire once and never again, and adds a
one-command `yarn deploy:local` that builds + replaces the app in
`/Applications` + relaunches it.

Crucially the deployed app must be **production-compiled**, not a
`build:dev` build: the development webpack config sets the renderer's
`publicPath` to `http://localhost:3000/build/`, so a packaged dev build's
`index.html` loads `renderer.js` from the `yarn start` dev server — which
isn't running for a standalone install, leaving a blank, unusable window.
Production compile references a local `renderer.js`, so the app runs on its
own. To keep the local app isolated from a real GitHub Desktop install we
still *package* with `NODE_ENV=development` (dev name/bundleID/userData,
local codesigning), just *compile* in production mode.

## Upstream link

- None.

## Touched files

- `script/build.ts` — `packageApp`'s `osxSign.identity` configuration.
- `package.json` — `scripts.deploy:local` and `scripts.build:local` entries.
- `script/deploy-local.ts` — new script implementing the deploy workflow.

## Change summary

### `script/build.ts`

- In `packageApp`, when `isDevelopmentBuild` is true, read
  `process.env.DESKTOP_DEV_CODESIGN_IDENTITY` and pass it to
  `osxSign.identity`. Falls back to upstream's `'-'` (ad-hoc) when the env
  var is unset, so behavior for upstream contributors and CI is unchanged.
- `identityValidation` is left at `!isDevelopmentBuild`, i.e. always off
  for dev — a self-signed identity won't match electron-osx-sign's
  "Apple Development:" / "Developer ID Application:" patterns and would
  otherwise fail validation.

### `package.json`

- Adds `"deploy:local"` script that runs the new `deploy-local.ts` under
  `NODE_ENV=development` so `dist-info` resolves the dev paths
  (`GitHub Desktop-dev.app`, `dist/GitHub Desktop-dev-darwin-arm64/`).
- Adds `"build:local"` script = `yarn compile:prod && cross-env
  NODE_ENV=development ts-node … script/build.ts`. The production webpack
  compile makes the renderer self-contained (local `renderer.js`, `__DEV__`
  false); packaging under `NODE_ENV=development` keeps the isolated `-dev`
  name/bundleID/userData and the local codesigning path, avoiding the
  Developer ID + notarization a real `build:prod` would require.

### `script/deploy-local.ts`

- macOS-only. Runs `yarn build:local` (inheriting the codesign env var),
  then quits any running instance of the dev app via
  `osascript -e 'quit app "GitHub Desktop-dev"'`, waits up to 10 s for the
  process to exit (polled with `pgrep -x`), falls back to `pkill -x` if
  needed, removes `/Applications/GitHub Desktop.app`, copies the freshly
  built bundle from `dist/...-darwin-<arch>/GitHub Desktop-dev.app` to
  `/Applications/GitHub Desktop.app`, and `open`s it.
- Note the asymmetry: the bundle is **installed** as `GitHub Desktop.app`
  (so it shows up under the familiar name in Finder/Dock/Spotlight) but
  the process name baked into `Contents/MacOS/` is still
  `GitHub Desktop-dev`, which is what the quit / pgrep / pkill calls
  target.
- Strips `ELECTRON_RUN_AS_NODE` and `NoDefaultCurrentDirectoryInExePath`
  from the env passed to both the build and the final `open`. Electron-
  hosted shells (Claude Code, VS Code's integrated terminal) export
  `ELECTRON_RUN_AS_NODE=1`; `open` propagates it to the launched app, which
  then runs as plain Node — no window, silent exit. Stripping it makes the
  launch behave the same regardless of which shell `deploy:local` runs in.

## Verify

One-time setup:

1. In Keychain Access → Certificate Assistant → **Create a Certificate…**,
   make a *Self Signed Root* certificate with type *Code Signing*, store
   it in the **login** keychain, and (after creation) double-click it →
   **Trust** → set *Code Signing* to **Always Trust**.
2. Confirm it's visible: `security find-identity -v -p codesigning` should
   list it (e.g. `"Local Electron Dev"`).
3. Export the identity name:
   `export DESKTOP_DEV_CODESIGN_IDENTITY="Local Electron Dev"` (add to
   `~/.zshrc` to make permanent).

Then:

1. Run `yarn deploy:local`. Expect the build to finish, the running app
   (if any) to quit, `/Applications/GitHub Desktop.app` to be replaced,
   and the new app to launch with a **real, rendered window** (not a blank
   one). Confirm the deployed `Contents/Resources/app/index.html` references
   `src="renderer.js"` (local) and **not** `http://localhost:3000`.
2. Run
   `codesign -dv "/Applications/GitHub Desktop.app"`. Expect
   `Authority=Local Electron Dev` (or whatever identity name you used),
   **not** `adhoc`.
3. Approve the first-time firewall prompt if it appears.
4. Quit the app, run `yarn deploy:local` again, relaunch. The firewall
   prompt should **not** re-appear — the signature is stable so macOS
   remembers the approval.

## Caveats

- macOS-only. The script exits with an error on Windows / Linux.
- Without `DESKTOP_DEV_CODESIGN_IDENTITY` set, `deploy:local` still works
  but each rebuild produces a fresh ad-hoc signature and the firewall
  prompt will re-fire — defeating the point. The env var is the load-
  bearing piece of the workflow.
- `deploy:local` will overwrite whatever sits at
  `/Applications/GitHub Desktop.app`, including a real App-Store /
  official install of GitHub Desktop. If you want to keep an official
  build side-by-side, edit `installedAppPath` in `script/deploy-local.ts`
  to point somewhere else (e.g. `GitHub Desktop Local.app`).
- The osascript graceful-quit relies on the app name macOS knows it by
  (`GitHub Desktop-dev`, derived from `CFBundleExecutable`). If a future
  change to upstream renames the dev executable, update the
  `getExecutableName()`-derived calls in `deploy-local.ts` accordingly.
- The deployed app is production-compiled, so `__DEV__` is false: dev-only
  niceties (React DevTools auto-install, hot reload) are absent — expected,
  this is for *using* the app, not live-editing it. For an HMR live-edit
  loop use `yarn start` instead.
