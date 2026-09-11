import * as Path from 'path'
import { createHash } from 'crypto'
import QuickLRU from 'quick-lru'
import { ITokens } from '../highlighter/types'
import { IFileContents } from '../../ui/diff/syntax-highlighting'
import { getOldPathOrDefault } from '../get-old-path'
import { IDiffestTokens } from './tokens'
import type { DiffestResponse, IDiffestRequest } from './worker'

/**
 * The extensions Diffest has a parser for. It reads `.css` and `.html` with
 * their own grammars and everything else as JavaScript, so a file outside this
 * list would be read with the wrong grammar rather than not at all.
 */
const DiffestExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.css',
  '.html',
  '.htm',
])

/**
 * Past this many lines, on either side, the file is left to git.
 *
 * Diffest's cost grows with about the cube of the line count: on this repo's
 * history, 700 lines take about 1.6 s and 1,000 take 7 s. It runs in a worker,
 * so the UI does not wait, but late marks help nobody. This cap keeps a
 * typical file under 2 s.
 */
const MaxDiffestLines = 700

/**
 * The answers for the last few files, `null` included. A click back to a file
 * you just left is then instant, and a file Diffest cannot read is not read
 * again.
 */
const overlayCache = new QuickLRU<string, IDiffestTokens | null>({
  maxSize: 20,
})

/**
 * Diffest's marks for a file, or `null` when there are none.
 *
 * Every way this can decline is a `null`, because to the caller each one means
 * the same thing: show the git diff, say nothing.
 */
export async function getDiffestOverlay(
  contents: IFileContents,
  signal: AbortSignal
): Promise<IDiffestTokens | null> {
  const { file, oldContents, newContents } = contents
  const path = file.path
  const ext = Path.extname(path).toLowerCase()

  if (!DiffestExtensions.has(ext)) {
    return null
  }

  // An added or deleted file has nothing on one side, and Diffest would only
  // say again what the `+` or `-` on every line already says.
  if (oldContents.length === 0 || newContents.length === 0) {
    return null
  }

  // A rename can change the language, and both sides are read with one
  // grammar.
  if (Path.extname(getOldPathOrDefault(file)).toLowerCase() !== ext) {
    return null
  }

  // The new side came back at the 1MB cap, which means it was cut mid-line.
  if (!contents.canBeExpanded) {
    return null
  }

  if (
    oldContents.length > MaxDiffestLines ||
    newContents.length > MaxDiffestLines
  ) {
    return null
  }

  // Lines were split on `/\r?\n/` on the way in, so line i of this text is
  // line i + 1 in the diff view.
  const before = oldContents.join('\n')
  const after = newContents.join('\n')

  const key = cacheKey(path, before, after)
  const cached = overlayCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  let response: DiffestResponse
  try {
    response = await runInWorker({ before, after, ext }, signal)
  } catch (error) {
    // A stopped run is not an answer, so it is not cached: the next look at
    // this file has to run again.
    if (!signal.aborted) {
      log.debug(`[diffest] the worker failed on ${path}`, error)
    }
    return null
  }

  const overlay = toOverlay(path, response)
  overlayCache.set(key, overlay)
  return overlay
}

/**
 * Runs one diff in a worker of its own. When the signal fires, the worker is
 * terminated at once: a file switch then costs nothing, where a shared worker
 * would first finish seconds of work nobody waits for.
 */
function runInWorker(
  request: IDiffestRequest,
  signal: AbortSignal
): Promise<DiffestResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }

    // The renderer bundle exports through `module.exports`, and a worker has no
    // `module`. Without this, the worker's last line throws, and every run
    // fails before it can answer.
    const worker = new Worker(
      /* webpackEntryOptions: { library: { type: "var", name: "diffestWorker" } } */
      new URL('./worker', import.meta.url)
    )

    const stop = () => {
      worker.terminate()
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', stop, { once: true })

    const finish = () => {
      signal.removeEventListener('abort', stop)
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<DiffestResponse>) => {
      finish()
      resolve(event.data)
    }

    worker.onerror = event => {
      finish()
      reject(event.error ?? new Error(event.message))
    }

    worker.postMessage(request)
  })
}

function toOverlay(
  path: string,
  response: DiffestResponse
): IDiffestTokens | null {
  if (response.kind === 'error') {
    log.debug(`[diffest] could not diff ${path}: ${response.message}`)
    return null
  }

  const overlay = response.tokens
  if (overlay === null) {
    log.debug(`[diffest] the view does not match the text of ${path}`)
    return null
  }

  // A view with no marks at all is treated as no answer. When there is no
  // overlay, the view gives the file back to git's colours; an overlay that
  // paints nothing would leave the diff with no marks.
  if (isEmpty(overlay.before) && isEmpty(overlay.after)) {
    return null
  }

  return overlay
}

function isEmpty(tokens: ITokens): boolean {
  for (const _ in tokens) {
    return false
  }
  return true
}

/**
 * Keyed on the text that was diffed, not on the file. `file.id` stays the same
 * across an edit, and marks at offsets the text no longer has are worse than
 * none.
 */
function cacheKey(path: string, before: string, after: string): string {
  const hash = createHash('sha1')
  hash.update(before)
  hash.update('\0')
  hash.update(after)
  return `${path}\0${hash.digest('hex')}`
}
