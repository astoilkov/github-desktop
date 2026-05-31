# 003 — `deploy:local`: build, self-sign, and install a local GitHub Desktop

## Goal

Give the fork a one-command way to build the app and install it as the
**production-named** `GitHub Desktop.app` in `/Applications`, signed with a
**self-signed** "Local Electron Dev" certificate so it has a *stable* code
identity across rebuilds (unlike ad-hoc `-` signing, whose hash changes every
build and resets macOS keychain/permission grants).

Two things make a naive `yarn build:prod` + copy unusable for this:

1. **It won't launch.** A production build runs with the hardened runtime, and
   under a self-signed certificate (which has no Team ID) macOS **library
   validation** refuses to load `Electron Framework` into the signed
   main/helper processes — the app dies at launch with a `dyld` "different Team
   IDs" error. The fix is the
   `com.apple.security.cs.disable-library-validation` entitlement on the
   signed executables.
2. **It would overwrite itself.** A `production`-channel app auto-checks
   GitHub's update feed on launch and every 4h. Because the local build's
   version (`3.5.9-beta3`) is behind the live release, Squirrel would download
   and install the upstream build *over* the local one. The local build must
   opt out of update checks.

`yarn deploy:local` handles both: it builds a production-named app signed with
the local cert + the disable-library-validation entitlement, with update checks
compiled out, then quits any running copy, swaps it into `/Applications`,
verifies the signature, and relaunches.

## Upstream link

- None. Local developer tooling, not intended for upstream.

## Touched files

- `script/deploy-local.ts` (new) — orchestrator run by `yarn deploy:local`.
- `script/entitlements-local.plist` (new) — production entitlements plus
  `com.apple.security.cs.disable-library-validation`.
- `script/build.ts` — `packageApp`'s `osxSign` block, plus the
  `localSignIdentity` / `localEntitlementsPath` constants near the top.
- `package.json` — `scripts.deploy:local`.
- `app/app-info.ts` — `getReplacements` (new `__SKIP_UPDATE_CHECK__` define).
- `app/src/lib/globals.d.ts` — `__SKIP_UPDATE_CHECK__` global declaration.
- `app/src/ui/app.tsx` — `checkForUpdates` method in the `App` component.

## Change summary

### `script/deploy-local.ts` (new)

Top-level `deployLocal()` that: asserts macOS; asserts a `Local Electron Dev`
code-signing identity exists in the keychain (`security find-identity`, with a
helpful error if missing); runs `yarn build:prod` with
`NODE_ENV=production`, `DESKTOP_LOCAL_SIGN_IDENTITY="Local Electron Dev"`, and
`DESKTOP_SKIP_UPDATE_CHECK=1`; resolves the built `${getProductName()}.app`
under `getDistPath()`; quits any running copy via `osascript`, waiting on
`pgrep` for the process to exit; `ditto`s the build into
`/Applications/<ProductName>.app`; runs `codesign --verify --deep --strict`;
and `open`s it. The signing identity is overridable via
`DESKTOP_LOCAL_SIGN_IDENTITY`.

### `script/entitlements-local.plist` (new)

The three production entitlements (`allow-unsigned-executable-memory`,
`automation.apple-events`, `allow-jit`) plus
`com.apple.security.cs.disable-library-validation` — the key that lets the
team-id-less self-signed framework load under the hardened runtime.

### `script/build.ts`

- Add `localSignIdentity = process.env.DESKTOP_LOCAL_SIGN_IDENTITY` and
  `localEntitlementsPath` (`script/entitlements-local.plist`) near the other
  build constants.
- In `packageApp`'s `osxSign`, when `localSignIdentity` is set: sign with that
  identity, force `type: 'development'`, disable `identityValidation`, and use
  the local entitlements. All three are gated on the env var, so the default
  development (`-`) and distribution code paths are unchanged when it is unset.

### `package.json`

- Add `"deploy:local": "cross-env NODE_ENV=production ts-node -P
  script/tsconfig.json script/deploy-local.ts"`. `NODE_ENV=production` is set
  here so the `getProductName()` / `getDistPath()` calls in the script resolve
  to the production-named app.

### `app/app-info.ts`

- In `getReplacements`, add `__SKIP_UPDATE_CHECK__: process.env
  .DESKTOP_SKIP_UPDATE_CHECK === '1'` (an unstringified boolean, like
  `__DEV__`). Defaults to `false`.

### `app/src/lib/globals.d.ts`

- Declare `__SKIP_UPDATE_CHECK__: boolean`.

### `app/src/ui/app.tsx`

- In the `App.checkForUpdates` method — the single chokepoint that every update
  path funnels through (the on-launch check, the 4h interval, and the manual
  "Check for Updates" menu item) — add an early `return` when
  `__SKIP_UPDATE_CHECK__` is true, right after the existing
  `__LINUX__ || __RELEASE_CHANNEL__ === 'development'` guard.

## Caveats

- **Requires a `Local Electron Dev` code-signing certificate** in the keychain,
  trusted for code signing (Keychain Access → Certificate Assistant → Create a
  Certificate, type "Code Signing"). `deploy:local` checks for it and stops
  with setup instructions if it is absent.
- **`disable-library-validation` is only safe/appropriate for a local build.**
  It is intentionally NOT added to the regular `entitlements.plist` /
  `entitlements-dev.plist`; only the env-gated local path uses it.
- **Self-signed, not notarized.** `spctl` will report the app as rejected and
  Gatekeeper would block it if it were quarantined — fine for a locally-built
  app on your own machine, not for distribution.
- **The "what's new" showcase banner can still fetch release notes.**
  `__SKIP_UPDATE_CHECK__` gates `checkForUpdates` (which does the actual
  download/install), not the cosmetic `isUpdateShowcase` release-notes fetch.
  No update is ever installed; only a banner may appear.
- **Verifying the GUI launch must be done by a human** — a non-GUI shell
  context can't keep an Electron window alive, so "exits immediately" when run
  from such a shell is an artifact, not a failure.

## Verify

Prerequisite: a `Local Electron Dev` code-signing identity exists —
`security find-identity -v -p codesigning` lists it.

1. Run the deploy:

   ```sh
   yarn deploy:local
   ```

   Expected: builds, prints `Deployed GitHub Desktop to /Applications/GitHub
   Desktop.app.`, and relaunches the app. It should open a normal window.

2. Confirm the signature and identity:

   ```sh
   codesign -dvv "/Applications/GitHub Desktop.app" 2>&1 | grep -E "Authority|Identifier"
   codesign --verify --deep --strict "/Applications/GitHub Desktop.app" && echo OK
   ```

   Expected: `Authority=Local Electron Dev`, `Identifier=com.github.GitHubClient`,
   and `OK`.

3. Confirm library validation is disabled on the executables (this is what lets
   it launch at all):

   ```sh
   codesign -d --entitlements :- "/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop" \
     | grep -c disable-library-validation   # → 1
   ```

4. Confirm updates are off: launch the app, leave it open, and confirm it is
   never replaced by an upstream release (no "update available" banner / no
   restart-to-update prompt). The build stays at version `3.5.9-beta3`
   (`/Applications/GitHub Desktop.app/Contents/Info.plist` →
   `CFBundleShortVersionString`) indefinitely.
