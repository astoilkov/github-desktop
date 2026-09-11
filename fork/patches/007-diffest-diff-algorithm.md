# 007 — Diffest as a diff algorithm option

## Goal

Desktop shows diffs the way git computes them: whole lines added and removed.
The only detail inside a line is a prefix/suffix trim (`relativeChanges`). It
cannot say *this value went from 2 to 3*, or *this line moved above that one*.

This adds a second algorithm, **Diffest**, from `~/repos/diffing-testing-framework`.
When it is on, its marks are painted on top of the diff Desktop already shows:
a changed value is painted as that value, not as the line that holds it, and
both ends of a moved line are painted.

Press **⇧⌘\\** (Ctrl+Shift+\\ on Windows and Linux) to switch between Git and
Diffest. The Diff Settings popover has the same choice as a radio group.

Git still makes the hunks, and hunk expansion stays the same, but inside a
hunk the rows follow Diffest's view rather than git's order. And where git shows an old line as deleted and Diffest reads it as kept — a
signature that gained a parameter, a line only re-indented or joined onto
another — Diffest mode hides that deleted row. Because a hidden row could still
be selected, line and hunk selection and line discard are off while Diffest
paints a file. The file checkbox still stages the whole file. Every file Diffest
cannot read gets the plain git diff, with no message.

## Upstream link

- None

## Prerequisites

- A sibling `../diffing-testing-framework` checkout, built with `bun run build`.
  Root `package.json` depends on it as `"diffest": "link:../diffing-testing-framework"`,
  so the repo does not install without it. **Webpack reads `lib/`, not `src/`**:
  after an edit to the algorithm, run `bun run build` again, or Desktop keeps the
  old behaviour.
- The framework's `package.json` must have, and has:
  - `main` and `types`, because Desktop resolves modules the node10 way and
    ignores `exports`;
  - a `default` condition in `exports["."]`, because Desktop compiles to
    `require`, and webpack rejects an exports map with only `import`;
  - `license: "MIT"`, because `legal-eagle` stops `yarn build:prod` on a
    package with no license;
  - its runtime packages under `devDependencies`. `lib/` bundles them, and
    under `dependencies` yarn copies them into Desktop's lockfile.
- The framework's `build` script runs `scripts/declarations.ts` after `tsc`. It
  rewrites the `./x.ts` imports in `lib/**/*.d.ts` to `./x.js`, which Desktop's
  type check can follow.

## Touched files

Upstream files:

- `app/src/ui/diff/diff-options.tsx` — `IDiffOptionsState`, the constructor, new
  `componentDidMount` / `componentWillUnmount`, `render` (the algorithm label),
  `renderPopover`, and new
  `renderDiffAlgorithm` / `onGitAlgorithmSelected` / `onDiffestAlgorithmSelected`.
- `app/src/ui/diff/side-by-side-diff.tsx` — `ISideBySideDiffState`, the
  `diffestAbortController` and `diffAlgorithmSubscription` fields,
  `componentDidMount`, `componentWillUnmount`, `componentDidUpdate`, new
  `initDiffestOverlay`, `createFullRow`, `getRowDataPopulated`, the container
  class and `<List>` props in `render`, `getCurrentDiffRows` and every method
  that called `getDiffRows` directly (`getRowSelectableGroupDetails`,
  `renderRow`, `getDiffLineNumber`, `startSearch`), `calcSearchTokens`, new
  `getDiffestRows`, new
  `hasDiffestOverlay` / `canSelectLines`,
  `getSelection`, `onContextMenuLine`, `onContextMenuHunk`, and
  `onDiffContainerRef` with the new `stopMoveHover` field.
- `app/webpack.development.ts` — `output.workerPublicPath` in `rendererConfig`.
- `app/styles/desktop.scss` — one `@import`.
- `package.json` / `yarn.lock` — the `diffest` link.

New files, which hold most of the code and cannot conflict:

- `app/src/lib/diffest/engine.ts` — the skip rules, the cache, and the worker.
- `app/src/lib/diffest/worker.ts` — runs `diff()` and `tokensFromView` off the
  UI thread.
- `app/src/lib/diffest/tokens.ts` — a Diffest view → Desktop's `ITokens`.
- `app/src/lib/diffest/inline.ts` — puts removed text back into a new line.
- `app/src/ui/diff/diff-algorithm.ts` — the setting, its emitter, and the
  shortcut.
- `app/src/ui/diff/diffest-move-hover.ts` — lights both ends of a move on
  hover.
- `app/src/ui/diff/diffest-rows.ts` — git's rows, laid out in Diffest's order.
- `app/styles/ui/_diffest-diff.scss` — the mark colours and their theme
  variables.
- `app/test/unit/diffest-tokens-test.ts`.

## Change summary

- **`diff-algorithm.ts`** — a module singleton that keeps the setting in
  localStorage, with an `event-kit` emitter. The two components that care read
  it directly. This keeps the patch small: `showSideBySideDiff` goes from
  `AppStore` through six upstream files of prop passing before it reaches
  `DiffOptions`. The precedent is `app/src/lib/drag-and-drop-manager.ts`.

  The shortcut is one `keydown` listener on `window`, added when the module
  loads. It is not in `SideBySideDiff.onWindowKeyDown`: two diffs can be on
  screen at once (the pull request dialog over the changes list), and if each
  toggled, the second would undo the first. It matches `event.code ===
  'Backslash'`, because with Shift held `event.key` is `|`.

- **`tokens.ts`** — the hard part. A Diffest view is lines of segments (`same`,
  `added`, `deleted`, `changed`), but **its lines are not the file's lines**.
  The view gives back the two versions only as a formatter would read them:
  Diffest breaks a block open over several lines, writes one back onto a single
  line, and drops the comma before a closing bracket. So each side of the view
  is read together with the file, character by character. Whitespace is
  skipped on both, and a stray `,` or `;` on either. Any other mismatch gives
  `null`, and the file keeps the git diff.

  What gets painted follows the markup table in the framework's `CLAUDE.md`:
  `added` → `df-added` on the new side, `deleted` → `df-deleted` on the old
  side, `changed` → `df-deleted` on its old half and `df-changed` on its new
  half. Quiet marks paint nothing. Both ends of a move get
  `df-moved df-m-<n>` on the text the line kept, and the end it left also gets
  `df-moved-from`, dimmed to 0.3 opacity. `diffest-move-hover.ts` watches the
  pointer: on either end, one `<style>` rule for that `<n>` lights both ends at
  full opacity. It is a style rule, not a class on the spans, because the rows
  are virtualized and a class would go with a row that scrolls away. `syntaxHighlightLine` prefixes each class with `cm-`.

- **`engine.ts`** — returns `null`, and so the git diff, for:
  - an extension outside `.js .jsx .mjs .cjs .ts .tsx .mts .cts .css .html
    .htm` (Diffest reads everything else as JavaScript);
  - an added or deleted file;
  - a rename that changed the extension;
  - `!canBeExpanded` (the new side was cut mid-line at 1MB);
  - more than **600 lines** on either side.

  The line cap exists because Diffest's cost grows with about the cube of the
  line count: 150 lines take 0.2 s, 300 take 0.8 s, 600 take 6 s, and 2,259
  take three minutes. Answers, `null` included, are cached in a `QuickLRU`
  keyed on `sha1(before + after)`, never on `file.id`, which stays the same
  across an edit.

  Each run gets its own `Worker`, which is terminated when the signal aborts.
  So a file switch stops at once, not after seconds of work for a file no
  longer on screen. The `webpackEntryOptions` comment on `new Worker(...)` is
  required: the renderer bundle exports through `module.exports`, a worker has
  no `module`, and without it the worker's last line throws.

- **`webpack.development.ts`** — `workerPublicPath: './'`. The dev page is a
  `file://` document, but its `publicPath` is the dev server, and a worker must
  have the page's origin. `./` loads the worker from `out/`, next to
  `index.html`, where `compile:dev` writes it. Production needs nothing: its
  public path is already `file://`.

- **`side-by-side-diff.tsx`** — two state fields for the marks.
  `initDiffestOverlay` runs from mount, from the algorithm emitter, and from
  `componentDidUpdate` **on its own gate**: `props.fileContents !==
  prevProps.fileContents`. Not `highlightParametersEqual`, which compares
  `state.diff.text`: that changes on every hunk expansion, and would diff the
  file again for the same answer. `SeamlessDiffSwitcher` keeps the
  `IFileContents` object while the same file stays selected. One
  `AbortController` per instance, aborted on each new run and on unmount.

  In `getRowDataPopulated`, where Diffest marks a line, git's prefix/suffix
  guess for that line is dropped rather than layered under it. This is **per
  line**: a line Diffest does not mark keeps today's highlight. Diffest's layer
  goes after the search tokens, so a search hit still reads as one. In
  `createFullRow`'s context branch, each side is pushed on its own, without the
  `??` fallback the syntax tokens use, because each end of a move is marked on
  its own side.

  **Hidden deleted rows.** Where git shows an old line as deleted and Diffest
  keeps it, Unified shows it the way Diffest's own page does: once. So
  `order.push(x)` → `unsorted.push(x)` is one row, `orderunsorted.push(x)`, with
  `order` red and `unsorted` yellow. `tokensFromView` returns
  `keptBeforeLines`, the old lines whose text all belongs to lines Diffest
  keeps, and `inlineDeletions`, each removed text with its old line and the new
  line and column it goes in front of. `withDiffestRows` hides the `Deleted` row
  of a kept line and hands its removed text to `getRowDataPopulated`, where
  `inline.ts` puts it into the new row and moves every token after it. If any
  removed piece of the line would land on a row git does not show as added,
  the old row stays and nothing goes in, so no text is lost or shown twice.
  Blank lines keep git's rows. 

  **Diffest's order.** Inside a hunk the rows follow Diffest's view, not git.
  Git lists every old line of a change before every new one. Diffest puts a
  removed line where it belongs, such as the rest of a call right after the
  line that replaced its head. `tokensFromView` returns `beforeLineRows` and
  `afterLineRows`, the view row each line starts on, and `diffest-rows.ts`
  sorts the rows between two hunk headers by it. Each side keeps git's order,
  because a view lists each version's lines in order. A line with no text
  borrows the place of its neighbour on the same side, and on a tie the old
  line goes first. Hunk headers stay put, so expansion works as before. In
  Split, git's pairs are taken apart, and an old and a new line sit side by
  side only when Diffest puts them on one view line. An old line with no mark
  and no partner is hidden (`unmarkedBeforeLines`). Every lookup of a row by index — render, search, hunk groups,
  line numbers — now goes through `getCurrentDiffRows`, since an index into the
  unfiltered rows would point at the wrong row. The row-height cache is keyed by
  row position, so when Diffest's answer changes the cache is cleared and the
  list measures every row again with `recomputeRowHeights`. Clearing alone is
  not enough: the rows have already rendered with the old heights, so the
  blank line after a hidden row keeps a tall row's height and the next row is
  cut to one line.

  `canSelectLines()` gates line and hunk selection, the gutter checkboxes, and
  line and hunk discard while Diffest paints the file. Otherwise, unticking the
  visible new line of a pair would still commit its hidden old half.

- **`diff-options.tsx`** — a third fieldset, *Diff algorithm*, with Git and
  Diffest, and a line that names the shortcut. Left of the settings button, a
  label says which algorithm is in use. It subscribes to the store, so the
  radio and the label follow the shortcut.

- **`_diffest-diff.scss`** — the colours of the framework's own page (green,
  red, yellow, blue), in light and dark. Under `.diffest-overlay` the row
  background goes and the marks are the only colour. The `+`/`-` prefix is
  hidden with `visibility: hidden`, not removed: it is what spaces the code
  away from the line numbers, as in git's view. A
  deleted line still has a number on the left only, and an added line on the
  right only. `SideBySideDiff` sets `.diffest-overlay` only when Diffest
  returned marks, so a file it cannot read keeps git's colours.

- **`desktop.scss`** — the import goes here, not in `_ui.scss`, which is a long
  list upstream appends to every release.

## Verify

1. In `../diffing-testing-framework`: `bun run test` and `bun run build`. Then
   `grep -rlE "['\"]\.{1,2}/[^'\"]*\.ts['\"]" lib --include='*.d.ts'` finds
   nothing.
2. `yarn install`. `yarn.lock` gains only the `diffest` link entry.
3. `yarn test:unit app/test/unit/diffest-tokens-test.ts` passes.
4. `yarn compile:dev` passes and emits `out/app_src_lib_diffest_worker_ts.js`.
   The end of that file must not have `module.exports`.
5. `yarn build:dev && yarn start`. Open a `.ts` file under 600 lines where one
   constant changed. Press ⇧⌘\\. Within a second, only the constant is painted:
   red on the left, yellow on the right, and the row is neither green nor red.
   Press ⇧⌘\\ again: git's row colours come back at once.
6. Open Diff Settings: the radio shows the current algorithm and follows ⇧⌘\\.
7. Unified ↔ Split: the marks stay, and no new worker starts.
8. Arrow through a long list of changed files: at most one worker runs per
   diff, and the marks that land match the file on screen.
9. Plain git diff, with no `.diffest-overlay`, for: a `.md` file, a binary
   file, an added file, a deleted file, a `util.js → util.ts` rename, and a
   file over 600 lines.
10. With Diffest on, in Unified, change a function signature by adding a
    parameter: only the new line shows, with the parameter painted green.
    Change `order.push(x)` to `unsorted.push(x)`: one row shows
    `orderunsorted.push(x)`, with `order` red and `unsorted` yellow.
    The gutter has no checkboxes, and the popover says line selection is off.
    The file checkbox still commits the whole file. Press ⇧⌘\\: git's deleted
    row and the checkboxes come back.
11. `yarn build:prod` passes `legal-eagle`.

## Caveats

- **The 600-line cap leaves most large files to git.** A faster algorithm is
  the fix, not a higher cap.
- In dev, the worker comes from the last `compile:dev`, not from the dev
  server. After an edit to `app/src/lib/diffest/`, run `yarn compile:dev` again.
- Moves *between* files are out of scope. They need every changed file's
  contents at once, which only the changeset level has. That means a new data
  path through `app-store`, which is the prop passing this patch avoids.
- With **Hide Whitespace Changes** on, git runs with `-w`, but `fileContents`
  is still the real file. Diffest can then mark lines the user is told are
  unchanged. Lines outside every hunk are never looked up, so this is only
  cosmetic.
- If an answer lands mid-scroll, `react-virtualized` keeps the visible rows
  unpainted until scrolling stops. Upstream's syntax highlighting does the
  same.
