import type { IDiffestTokens } from './tokens'

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

scope.onmessage = async (event: MessageEvent<IDiffestRequest>) => {
  scope.postMessage(await respond(event.data))
}

async function respond({
  before,
  after,
  ext,
}: IDiffestRequest): Promise<DiffestResponse> {
  try {
    // Diffest compiles its WebAssembly before it exports anything. A static
    // import would set `onmessage` only after that. The request comes first,
    // so it would be lost, and the engine would wait for an answer forever.
    const { default: diff } = await import(/* webpackMode: "eager" */ 'diffest')
    const { tokensFromView } = await import(
      /* webpackMode: "eager" */ './tokens'
    )

    const view = diff(before, after, ext)
    return { kind: 'tokens', tokens: tokensFromView(view, before, after) }
  } catch (error) {
    return { kind: 'error', message: String(error) }
  }
}
