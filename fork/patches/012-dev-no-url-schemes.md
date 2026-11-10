# 012 — Dev builds don't claim URL schemes

## Goal

A dev build (`yarn build:dev`, then `yarn start`) doesn't claim any URL
scheme. Upstream makes the dev app the default handler for `x-github-client`
and `github-mac` on each launch, and declares them in its `Info.plist`. That
takes the schemes from the production app, so links such as "Open in GitHub
Desktop" on github.com open the dev app. Upstream also registers the dev-only
`x-github-desktop-dev-auth` scheme. Now the production app keeps all its
schemes, and the dev app registers none.

## Upstream link

- None

## Touched files

- `app/src/main-process/main.ts` — the `app.on('ready')` handler, where it
  calls `setAsDefaultProtocolClient` for each item in `possibleProtocols`.
- `script/build.ts` — the `protocols` option in `packageApp`.

## Change summary

### `app/src/main-process/main.ts`

- Call `setAsDefaultProtocolClient` only when `__DEV__` is false.
  `possibleProtocols` stays the same, because the app also uses it to read
  URLs from the command line.

### `script/build.ts`

- Give `protocols` an empty list when `isDevelopmentBuild` is true, so the dev
  `Info.plist` has no `CFBundleURLTypes`. The production list is now always
  `x-github-desktop-auth`, `x-github-client`, and `github-mac`.

## Caveats

- Browser sign-in (OAuth) doesn't return to a dev build, because nothing
  handles `x-github-desktop-dev-auth`. Sign in with a token, or use a
  production build.

## Verify

1. Run `yarn build:dev`. Then run:

   ```sh
   plutil -p "dist/GitHub Desktop-dev-darwin-arm64/GitHub Desktop-dev.app/Contents/Info.plist" \
      | grep -c CFBundleURLSchemes   # → 0
   ```

2. Run `yarn start`, then open `x-github-client://openRepo/https://github.com/desktop/desktop`
   in a browser. The production GitHub Desktop opens, not the dev app.
