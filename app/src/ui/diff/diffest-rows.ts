import memoize from 'memoize-one'
import { DiffRowType, SimplifiedDiffRow } from './diff-helpers'
import type { IDiffestTokens, IInlineDeletion } from '../../lib/diffest/tokens'

/** The rows the diff shows, and the removed text that goes into them. */
export interface IDiffestRows {
  readonly rows: ReadonlyArray<SimplifiedDiffRow>

  /** Removed text to put in, by the new line it goes into, counted from 0. */
  readonly inline: ReadonlyMap<number, ReadonlyArray<IInlineDeletion>>
}

type Side = 'before' | 'after'
type DeletedRow = Extract<SimplifiedDiffRow, { type: DiffRowType.Deleted }>
type AddedRow = Extract<SimplifiedDiffRow, { type: DiffRowType.Added }>

/** A row, and the place Diffest's view gives it. */
interface IPlacedRow {
  readonly row: SimplifiedDiffRow
  readonly key: number

  /** Whether the place is the row's own, not borrowed from a neighbour. */
  readonly exact: boolean
}

/**
 * Git's rows, shown the way Diffest's view shows them.
 *
 * Git makes the hunks, and each hunk keeps its place, so hunk expansion works
 * as before. Inside a hunk the rows follow the view: git lists every old line
 * of a change before every new one, while Diffest puts a removed line where it
 * belongs, such as the rest of a call right after the line that replaced it.
 *
 * In Unified, an old line Diffest keeps has no row of its own. The text Diffest
 * reports as removed from it goes into the new row, just before what replaced
 * it. In Split, an old line and a new line sit side by side when Diffest puts
 * them on one view line, not when git lists them at the same position.
 */
export const withDiffestRows = memoize(function (
  rows: ReadonlyArray<SimplifiedDiffRow>,
  overlay: IDiffestTokens | undefined,
  showSideBySideDiff: boolean
): IDiffestRows {
  if (overlay === undefined) {
    return { rows, inline: new Map() }
  }

  if (showSideBySideDiff) {
    return {
      rows: bySection(rows, section => pairInViewOrder(section, overlay)),
      inline: new Map(),
    }
  }

  const { shown, inline } = withRemovedTextInline(rows, overlay)
  const inOrder = (section: ReadonlyArray<SimplifiedDiffRow>) =>
    inViewOrder(section, overlay).map(placed => placed.row)

  return { rows: bySection(shown, inOrder), inline }
})

/**
 * Hides the old row of each line Diffest keeps, and hands the text it reports
 * as removed to the new row. That needs every removed piece of the old line to
 * land on a row git shows as added. Where one cannot, the old row stays and
 * nothing goes in, so no text is lost or shown twice.
 */
function withRemovedTextInline(
  rows: ReadonlyArray<SimplifiedDiffRow>,
  overlay: IDiffestTokens
): {
  readonly shown: ReadonlyArray<SimplifiedDiffRow>
  readonly inline: ReadonlyMap<number, ReadonlyArray<IInlineDeletion>>
} {
  // Row line numbers count from 1, Diffest's from 0.
  const deletedLines = new Set<number>()
  const addedLines = new Set<number>()
  for (const row of rows) {
    if (row.type === DiffRowType.Deleted) {
      deletedLines.add(row.data.lineNumber - 1)
    } else if (row.type === DiffRowType.Added) {
      addedLines.add(row.data.lineNumber - 1)
    }
  }

  const blocked = new Set(
    overlay.inlineDeletions
      .filter(deletion => !addedLines.has(deletion.afterLine))
      .map(deletion => deletion.beforeLine)
  )
  const hidden = new Set(
    overlay.keptBeforeLines.filter(
      line => deletedLines.has(line) && !blocked.has(line)
    )
  )

  const inline = new Map<number, Array<IInlineDeletion>>()
  for (const deletion of overlay.inlineDeletions) {
    if (hidden.has(deletion.beforeLine)) {
      const inLine = inline.get(deletion.afterLine) ?? []
      inLine.push(deletion)
      inline.set(deletion.afterLine, inLine)
    }
  }

  return { shown: withoutDeletedRows(rows, hidden), inline }
}

/**
 * Split: git's pairs taken apart and paired again the way Diffest pairs them.
 * An old line with no mark and no partner is hidden: Diffest reads it as kept,
 * and alone on the left it would read as removed.
 */
function pairInViewOrder(
  section: ReadonlyArray<SimplifiedDiffRow>,
  overlay: IDiffestTokens
): ReadonlyArray<SimplifiedDiffRow> {
  const halves = section.flatMap((row): ReadonlyArray<SimplifiedDiffRow> => {
    if (row.type !== DiffRowType.Modified) {
      return [row]
    }
    const { beforeData, afterData, hunkStartLine } = row
    return [
      { type: DiffRowType.Deleted, data: beforeData, hunkStartLine },
      { type: DiffRowType.Added, data: afterData, hunkStartLine },
    ]
  })

  const unmarked = new Set(overlay.unmarkedBeforeLines)
  const placed = inViewOrder(halves, overlay)
  const output = new Array<SimplifiedDiffRow>()

  for (let start = 0; start < placed.length; ) {
    let end = start + 1
    while (end < placed.length && placed[end].key === placed[start].key) {
      end++
    }
    output.push(...pairOneViewRow(placed.slice(start, end), unmarked))
    start = end
  }

  return output
}

/** The rows Diffest puts on one view line, with old and new side by side. */
function pairOneViewRow(
  group: ReadonlyArray<IPlacedRow>,
  unmarked: ReadonlySet<number>
): ReadonlyArray<SimplifiedDiffRow> {
  const olds = new Array<DeletedRow>()
  const news = new Array<AddedRow>()
  // A line that only borrowed its place is not on this view line.
  for (const { row, exact } of group) {
    if (exact && row.type === DiffRowType.Deleted) {
      olds.push(row)
    } else if (exact && row.type === DiffRowType.Added) {
      news.push(row)
    }
  }

  const pairs = Math.min(olds.length, news.length)
  const paired = new Set<SimplifiedDiffRow>([
    ...olds.slice(0, pairs),
    ...news.slice(0, pairs),
  ])
  const output: Array<SimplifiedDiffRow> = olds
    .slice(0, pairs)
    .map((old, index) => ({
      type: DiffRowType.Modified,
      beforeData: old.data,
      afterData: news[index].data,
      hunkStartLine: old.hunkStartLine,
    }))

  for (const { row } of group) {
    if (paired.has(row)) {
      continue
    }
    if (
      row.type === DiffRowType.Deleted &&
      unmarked.has(row.data.lineNumber - 1)
    ) {
      continue
    }
    output.push(row)
  }

  return output
}

/**
 * The rows between two hunk headers, in the order of Diffest's view. The view
 * lists each version's lines in order, so each side keeps git's order and only
 * the two sides interleave. On a tie, the old line goes first.
 */
function inViewOrder(
  section: ReadonlyArray<SimplifiedDiffRow>,
  overlay: IDiffestTokens
): ReadonlyArray<IPlacedRow> {
  const own = section.map(row => getViewRow(row, overlay))
  const keys = withBorrowedKeys(section, own)

  return section
    .map((row, index) => ({ row, index, key: keys[index] ?? -1 }))
    .sort(
      (a, b) =>
        a.key - b.key || getRank(a.row) - getRank(b.row) || a.index - b.index
    )
    .map(({ row, index, key }) => ({
      row,
      key,
      exact: own[index] !== undefined,
    }))
}

/**
 * A line with no text has no place of its own in the view. It borrows the place
 * of the line before it on the same side, so it stays beside it. One at the
 * start borrows from the line after it.
 */
function withBorrowedKeys(
  section: ReadonlyArray<SimplifiedDiffRow>,
  own: ReadonlyArray<number | undefined>
): ReadonlyArray<number | undefined> {
  const keys = [...own]

  for (const side of ['before', 'after'] as const) {
    const indices = section.flatMap((row, index) =>
      isOnSide(row, side) ? [index] : []
    )

    let last: number | undefined
    for (const index of indices) {
      last = own[index] ?? last
      keys[index] ??= last
    }

    let next: number | undefined
    for (const index of [...indices].reverse()) {
      next = own[index] ?? next
      keys[index] ??= next
    }
  }

  return keys
}

/** Arranges the rows between each two hunk headers. The headers stay put. */
function bySection(
  rows: ReadonlyArray<SimplifiedDiffRow>,
  arrange: (
    section: ReadonlyArray<SimplifiedDiffRow>
  ) => ReadonlyArray<SimplifiedDiffRow>
): ReadonlyArray<SimplifiedDiffRow> {
  const output = new Array<SimplifiedDiffRow>()
  let section = new Array<SimplifiedDiffRow>()

  for (const row of rows) {
    if (row.type === DiffRowType.Hunk) {
      output.push(...arrange(section), row)
      section = []
    } else {
      section.push(row)
    }
  }
  output.push(...arrange(section))

  return output
}

/** Where Diffest's view puts the row: the view row its line starts on. */
function getViewRow(
  row: SimplifiedDiffRow,
  overlay: IDiffestTokens
): number | undefined {
  switch (row.type) {
    case DiffRowType.Deleted:
      return getLineRow(overlay.beforeLineRows, row.data.lineNumber)
    case DiffRowType.Added:
      return getLineRow(overlay.afterLineRows, row.data.lineNumber)
    case DiffRowType.Modified:
      return getLineRow(overlay.afterLineRows, row.afterData.lineNumber)
    case DiffRowType.Context:
      return (
        getLineRow(overlay.afterLineRows, row.afterLineNumber) ??
        getLineRow(overlay.beforeLineRows, row.beforeLineNumber)
      )
    case DiffRowType.Hunk:
      return undefined
  }
}

function getRank(row: SimplifiedDiffRow): number {
  switch (row.type) {
    case DiffRowType.Deleted:
      return 0
    case DiffRowType.Added:
      return 2
    default:
      return 1
  }
}

function isOnSide(row: SimplifiedDiffRow, side: Side): boolean {
  switch (row.type) {
    case DiffRowType.Deleted:
      return side === 'before'
    case DiffRowType.Added:
      return side === 'after'
    case DiffRowType.Hunk:
      return false
    default:
      return true
  }
}

function withoutDeletedRows(
  rows: ReadonlyArray<SimplifiedDiffRow>,
  lines: ReadonlySet<number>
): ReadonlyArray<SimplifiedDiffRow> {
  return rows.filter(
    row =>
      row.type !== DiffRowType.Deleted || !lines.has(row.data.lineNumber - 1)
  )
}

// Row line numbers count from 1, Diffest's from 0.
function getLineRow(
  lineRows: ReadonlyArray<number | null>,
  lineNumber: number
): number | undefined {
  return lineRows[lineNumber - 1] ?? undefined
}
