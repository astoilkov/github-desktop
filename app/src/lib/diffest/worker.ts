import diff from 'diffest'
import { IDiffestTokens, tokensFromView } from './tokens'

/** What the engine sends: the two versions of one file and its extension. */
export interface IDiffestRequest {
  readonly before: string
  readonly after: string
  readonly ext: string
}

/** What the worker sends back: the marks, or why there are none. */
export type DiffestResponse =
  | { readonly kind: 'tokens'; readonly tokens: IDiffestTokens | null }
  | { readonly kind: 'error'; readonly message: string }

// The renderer's types describe a window, whose `postMessage` needs a target
// origin. This runs in a worker, where it does not.
const scope = self as unknown as Worker

scope.onmessage = (event: MessageEvent<IDiffestRequest>) => {
  scope.postMessage(respond(event.data))
}

function respond({ before, after, ext }: IDiffestRequest): DiffestResponse {
  try {
    const view = diff(before, after, ext)
    return { kind: 'tokens', tokens: tokensFromView(view, before, after) }
  } catch (error) {
    return { kind: 'error', message: String(error) }
  }
}
