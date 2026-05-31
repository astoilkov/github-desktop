/* eslint-disable no-sync */

import * as cp from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getProductName } from '../app/package-info'
import { getDistPath } from './dist-info'

// Name of the self-signed code-signing certificate to sign with. Create one
// via Keychain Access → Certificate Assistant → Create a Certificate
// (type: "Code Signing"), then mark it trusted for code signing.
const signIdentity = process.env.DESKTOP_LOCAL_SIGN_IDENTITY ?? 'Local Electron Dev'

const applicationsDir = '/Applications'

deployLocal()

// Builds a production-named GitHub Desktop signed with a local self-signed
// certificate, then swaps it into /Applications and relaunches it. This gives a
// locally-built app a *stable* code-signing identity (unlike ad-hoc `-` signing,
// whose hash changes every build), so macOS keychain/permission grants persist
// across rebuilds.
function deployLocal() {
  if (process.platform !== 'darwin') {
    throw new Error('deploy:local is only supported on macOS.')
  }

  assertSigningIdentityExists()

  console.log(`Building a production app signed with "${signIdentity}"…`)
  cp.execSync('yarn build:prod', {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DESKTOP_LOCAL_SIGN_IDENTITY: signIdentity,
      // Don't let the app auto-update from upstream and overwrite this local
      // build (it's a production-channel app with an older version number, so
      // the update feed would otherwise replace it).
      DESKTOP_SKIP_UPDATE_CHECK: '1',
    },
  })

  const productName = getProductName()
  const builtApp = join(getDistPath(), `${productName}.app`)
  if (!existsSync(builtApp)) {
    throw new Error(`Expected the built app at ${builtApp}, but it wasn't there.`)
  }

  const destination = join(applicationsDir, `${productName}.app`)

  console.log(`Quitting any running copy of "${productName}"…`)
  quitApp(productName)

  console.log(`Replacing ${destination}…`)
  rmSync(destination, { recursive: true, force: true })
  cp.execSync(`ditto "${builtApp}" "${destination}"`)

  console.log('Verifying the deployed signature…')
  cp.execSync(`codesign --verify --deep --strict "${destination}"`)

  console.log('Relaunching…')
  cp.execSync(`open "${destination}"`)

  console.log(`\nDeployed ${productName} to ${destination}.`)
}

function assertSigningIdentityExists() {
  const identities = cp.execSync('security find-identity -v -p codesigning', {
    encoding: 'utf8',
  })

  if (!identities.includes(signIdentity)) {
    throw new Error(
      `Couldn't find a code-signing identity named "${signIdentity}" in your keychain.\n` +
        `Create a self-signed certificate with that name (Keychain Access →\n` +
        `Certificate Assistant → Create a Certificate…, type "Code Signing"), mark it\n` +
        `trusted for code signing, then run this again. Override the name with the\n` +
        `DESKTOP_LOCAL_SIGN_IDENTITY environment variable.`
    )
  }
}

function quitApp(productName: string) {
  try {
    cp.execSync(`osascript -e 'quit app "${productName}"'`, { stdio: 'ignore' })
  } catch {
    // Not running (or AppleScript declined) — nothing to quit.
  }

  // Wait for the process to actually exit before we overwrite it on disk.
  const mainProcess = `/${productName}.app/Contents/MacOS/${productName}`
  for (let i = 0; i < 20; i++) {
    try {
      cp.execSync(`pgrep -f "${mainProcess}"`, { stdio: 'ignore' })
    } catch {
      return // pgrep exits non-zero when there's no match → fully quit.
    }
    cp.execSync('sleep 0.5')
  }
}
