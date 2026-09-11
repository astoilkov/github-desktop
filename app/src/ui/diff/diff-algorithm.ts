import { Disposable, Emitter } from 'event-kit'
import { getEnum } from '../../lib/local-storage'

/** Which algorithm decides what a diff says changed. */
export enum DiffAlgorithm {
  /** What git reports: whole lines added and removed. */
  Git = 'git',
  /**
   * Diffest's marks painted on top of git's lines, so a changed value shows up
   * as that value rather than as the line it sits on.
   */
  Diffest = 'diffest',
}

const diffAlgorithmKey = 'diff-algorithm'

/**
 * Which algorithm the diff view should use, and a way to hear about it
 * changing.
 *
 * This deliberately sits outside the app store. Every other diff setting is
 * threaded from `AppStore` through `IAppState`, `Dispatcher`, `repository.tsx`,
 * and four separate diff hosts before it reaches `DiffOptions` — around six
 * files of pure prop passing. Only two components care about this one, and both
 * can read it where they stand, in the same way `dragAndDropManager` is read
 * directly by the components that need it.
 */
class DiffAlgorithmStore {
  private readonly emitter = new Emitter()
  private current =
    getEnum(diffAlgorithmKey, DiffAlgorithm) ?? DiffAlgorithm.Git

  public get value(): DiffAlgorithm {
    return this.current
  }

  public set(value: DiffAlgorithm) {
    if (value === this.current) {
      return
    }

    this.current = value
    localStorage.setItem(diffAlgorithmKey, value)
    this.emitter.emit('changed', value)
  }

  public toggle() {
    this.set(
      this.current === DiffAlgorithm.Git
        ? DiffAlgorithm.Diffest
        : DiffAlgorithm.Git
    )
  }

  public onDidChange(fn: (value: DiffAlgorithm) => void): Disposable {
    return this.emitter.on('changed', fn)
  }
}

export const diffAlgorithmStore = new DiffAlgorithmStore()

/** The keys that switch between the two algorithms, as the popover shows them. */
export const diffAlgorithmShortcut = __DARWIN__ ? '⇧⌘\\' : 'Ctrl+Shift+\\'

// One listener for the window, not one for each diff view. Two diffs can be on
// screen at once — the pull request dialog over the changes list — and if each
// toggled on the same key press, the second would undo the first.
window.addEventListener('keydown', onToggleShortcut)

function onToggleShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat) {
    return
  }

  const isCmdOrCtrl = __DARWIN__
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey

  // `code` and not `key`: with Shift held, `key` is `|` on a US layout.
  if (
    isCmdOrCtrl &&
    event.shiftKey &&
    !event.altKey &&
    event.code === 'Backslash'
  ) {
    event.preventDefault()
    diffAlgorithmStore.toggle()
  }
}
