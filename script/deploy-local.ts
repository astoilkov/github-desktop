import { execFileSync, spawnSync } from 'child_process'
import { cpSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

import { getDistPath, getExecutableName } from './dist-info'

const builtAppPath = join(getDistPath(), `${getExecutableName()}.app`)
const installedAppPath = `/Applications/GitHub Desktop.app`

// Electron-hosted shells (e.g. Claude Code, VS Code's integrated terminal)
// export ELECTRON_RUN_AS_NODE=1, which `open` propagates to the launched app,
// making the Electron binary run as plain Node — it opens no window and exits
// silently. Strip it (and its Windows sibling) so the launch behaves the same
// regardless of which shell `deploy:local` is run from.
const {
  ELECTRON_RUN_AS_NODE,
  NoDefaultCurrentDirectoryInExePath,
  ...cleanEnv
} = process.env

if (process.platform !== 'darwin') {
  console.error('deploy:local is macOS-only.')
  process.exit(1)
}

// Build with build:local: a production webpack compile (so the renderer is
// self-contained — production references a local renderer.js, whereas the dev
// compile points the renderer at the http://localhost:3000 dev server and only
// works under `yarn start`) packaged with NODE_ENV=development (so it keeps the
// isolated "-dev" name/bundleID/userData and is signed with the local cert
// rather than requiring a Developer ID + notarization).
console.log('Building app…')
const build = spawnSync('yarn', ['build:local'], {
  stdio: 'inherit',
  env: cleanEnv,
})
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

if (!existsSync(builtAppPath)) {
  console.error(`Built app not found at ${builtAppPath}`)
  process.exit(1)
}

console.log(`Quitting ${getExecutableName()} if running…`)
spawnSync('osascript', ['-e', `quit app "${getExecutableName()}"`], {
  stdio: 'ignore',
})
waitForExit(getExecutableName())

if (existsSync(installedAppPath)) {
  console.log(`Removing ${installedAppPath}…`)
  rmSync(installedAppPath, { recursive: true, force: true })
}

console.log(`Copying to ${installedAppPath}…`)
cpSync(builtAppPath, installedAppPath, {
  recursive: true,
  verbatimSymlinks: true,
})

console.log('Launching…')
execFileSync('open', [installedAppPath], { env: cleanEnv })

function waitForExit(processName: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const result = spawnSync('pgrep', ['-x', processName])
    if (result.status !== 0) {
      return
    }
    spawnSync('sleep', ['0.2'])
  }
  console.warn(`${processName} did not quit within 10s; force killing.`)
  spawnSync('pkill', ['-x', processName])
}
