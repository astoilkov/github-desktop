import { drawn, lineSide, moves } from 'diffest'
import type { DiffView, Segment } from 'diffest'
import { ILineTokens, ITokens } from '../highlighter/types'

/** What Diffest marked in one file, in the shape the diff view paints with. */
export interface IDiffestTokens {
  readonly before: ITokens
  readonly after: ITokens

  /**
   * The lines of the old version, counted from 0, that hold text but no mark.
   * Diffest reads them as kept, so a row git shows for one as deleted says
   * something Diffest does not.
   */
  readonly unmarkedBeforeLines: ReadonlyArray<number>

  /**
   * The lines of the old version, counted from 0, whose text all belongs to
   * lines Diffest keeps: edited in place, re-indented, or joined onto another.
   * Unlike an unmarked line, such a line can hold text Diffest reports as
   * removed. `inlineDeletions` says where that text goes in the new line.
   */
  readonly keptBeforeLines: ReadonlyArray<number>

  /** Text Diffest reports as removed from lines it keeps. */
  readonly inlineDeletions: ReadonlyArray<IInlineDeletion>

  /**
   * The row of Diffest's view each old line starts on, by line counted from 0.
   * `null` for a line with no text, which has no place of its own in the view.
   */
  readonly beforeLineRows: ReadonlyArray<number | null>

  /** The same, for each new line. */
  readonly afterLineRows: ReadonlyArray<number | null>
}

/**
 * Text removed from a line Diffest keeps. Diffest's own page writes it inside
 * the new line, just before what replaced it: `{~order~unsorted~}.push(x)`
 * reads as `order`, then `unsorted`, then `.push(x)` once.
 */
export interface IInlineDeletion {
  /** The old line the text came from, counted from 0. */
  readonly beforeLine: number

  /** The new line it goes into, counted from 0. */
  readonly afterLine: number

  /** The column of the new line that the text goes in front of. */
  readonly column: number

  readonly text: string
}

type Side = 'before' | 'after'

/** A run of text one side of the view holds, and the class it is painted with. */
interface IPiece {
  readonly text: string
  readonly paint: string | null

  /** Whether the piece belongs to a line Diffest keeps. */
  readonly kept: boolean

  /** The row of the view the piece is on. */
  readonly row: number

  /** On the old side: text that also goes into the new line. */
  readonly anchor?: boolean

  /** On the new side: removed text that goes in here. It holds no file text. */
  readonly inline?: string
}

/** One side of the view, placed on the file. */
interface IPlacement {
  /** The class on each character of the file. */
  readonly paints: ReadonlyArray<string | null>

  /** For each character the view matched, whether a kept line holds it. */
  readonly kept: ReadonlyArray<boolean | undefined>

  /** For each character the view matched, the row of the view it is on. */
  readonly rows: ReadonlyArray<number | undefined>

  /** Where each anchor or inline piece landed, in the order they came. */
  readonly anchors: ReadonlyArray<number>
}

/**
 * Diffest's marks, placed on the lines of the real file.
 *
 * The lines of a view are not the lines of the file. The view gives back both
 * versions only as a formatter would read them: Diffest breaks a block open
 * over several lines, or writes one back onto a single line, and it does not
 * keep the comma before a closing bracket. So each side of the view is read
 * together with the file, character by character, with whitespace skipped on
 * both and a stray `,` or `;` skipped on either. Each mark then lands where its
 * text is in the file.
 *
 * Returns `null` when the two texts do not agree. That is a view this does not
 * understand, and plain git is better than marks in the wrong place.
 */
export function tokensFromView(
  view: DiffView,
  before: string,
  after: string
): IDiffestTokens | null {
  const movePaints = getMovePaints(view)
  const afterPieces = getPieces(view, 'after', movePaints)
  const old = placePieces(getPieces(view, 'before', movePaints), before)
  const now = placePieces(afterPieces, after)

  // Each removed text has an anchor on both sides, so the two lists pair up in
  // order.
  if (
    old === null ||
    now === null ||
    old.anchors.length !== now.anchors.length
  ) {
    return null
  }

  const removed = afterPieces.flatMap(piece =>
    piece.inline === undefined ? [] : [piece.inline]
  )

  return {
    before: getTokens(before, old.paints),
    after: getTokens(after, now.paints),
    unmarkedBeforeLines: getUnmarkedLines(before, old.paints),
    keptBeforeLines: getKeptLines(before, old.kept),
    beforeLineRows: getLineRows(before, old.rows),
    afterLineRows: getLineRows(after, now.rows),
    inlineDeletions: removed.map((text, index) => {
      const { line, column } = locate(after, now.anchors[index])
      const beforeLine = locate(before, old.anchors[index]).line
      return { beforeLine, afterLine: line, column, text }
    }),
  }
}

/**
 * The class for each end of each move, by the view row it is on. Both ends of
 * a move share the `df-m-` number, so pointing at one can light the other. The
 * end the line left also gets `df-moved-from`, which is dimmed.
 */
function getMovePaints(view: DiffView): Map<number, string> {
  const paints = new Map<number, string>()

  moves(view).forEach(({ to, from }, index) => {
    paints.set(to, `df-moved df-m-${index}`)
    paints.set(from, `df-moved df-moved-from df-m-${index}`)
  })

  return paints
}

/**
 * The text one side of the view holds, in order. The rules for which segment
 * gives which text are those of `sides.ts` in the framework, which is how the
 * view gives back each version.
 */
function getPieces(
  view: DiffView,
  side: Side,
  movePaints: Map<number, string>
): ReadonlyArray<IPiece> {
  const pieces = new Array<IPiece>()

  view.forEach((line, row) => {
    const held = lineSide(line)
    if (held !== 'both' && held !== side) {
      return
    }

    const both = held === 'both'
    // An old line the page gives no row, such as the seat a carried line
    // left, is kept as well.
    const kept = both || !drawn(line)

    // The mark of a move goes on the text the line kept. The line's own marks
    // say what it changed on the way.
    const movePaint = movePaints.get(row) ?? null

    for (const segment of line.segments) {
      pieces.push(
        ...getSegmentPieces(segment, side, row, kept, both, movePaint)
      )
    }

    pieces.push({ text: '\n', paint: null, kept, row })
  })

  return pieces
}

function getSegmentPieces(
  segment: Segment,
  side: Side,
  row: number,
  kept: boolean,
  both: boolean,
  movePaint: string | null
): ReadonlyArray<IPiece> {
  switch (segment.kind) {
    case 'same':
      return [{ text: segment.text, paint: movePaint, kept, row }]
    case 'added': {
      const paint = segment.quiet ? null : 'df-added'
      return side === 'after' ? [{ text: segment.text, paint, kept, row }] : []
    }
    case 'deleted': {
      // Text removed from a line that stays also goes into the new line.
      const inline = both && segment.quiet !== true
      if (side === 'after') {
        return inline ? [getInlinePiece(segment.text, row)] : []
      }
      const paint = segment.quiet ? null : 'df-deleted'
      return [{ text: segment.text, paint, kept, row, anchor: inline }]
    }
    case 'changed': {
      // A carried change is counted where it used to be, where the view
      // writes its old text as a quiet deletion.
      if (side === 'before') {
        const paint = 'df-deleted'
        return segment.carried
          ? []
          : [{ text: segment.before, paint, kept, row, anchor: both }]
      }
      const changed = { text: segment.after, paint: 'df-changed', kept, row }
      return both && !segment.carried
        ? [getInlinePiece(segment.before, row), changed]
        : [changed]
    }
  }
}

function getInlinePiece(text: string, row: number): IPiece {
  return { text: '', paint: null, kept: true, row, inline: text }
}

/** The pieces of one side, placed on the file. */
function placePieces(
  pieces: ReadonlyArray<IPiece>,
  file: string
): IPlacement | null {
  const paints = new Array<string | null>(file.length).fill(null)
  const kept = new Array<boolean | undefined>(file.length)
  const rows = new Array<number | undefined>(file.length)
  const anchors = new Array<number>()
  let at = 0
  // Whitespace the view passed since the last character it matched. Removed
  // text goes in after as much of the file's whitespace, so `x = 2` becoming
  // `x = 3` reads `x = 23`, not `x =2 3`.
  let spaces = 0

  for (const piece of pieces) {
    if (piece.inline !== undefined) {
      let insertAt = at
      for (let left = spaces; left > 0 && isSpace(file[insertAt]); left--) {
        insertAt++
      }
      anchors.push(insertAt)
      continue
    }

    let previous = -1
    let first = -1

    for (const char of piece.text) {
      if (isSpace(char)) {
        spaces++
        continue
      }

      at = skipSpace(file, at)
      while (at < file.length && file[at] !== char && isStray(file[at])) {
        at = skipSpace(file, at + 1)
      }

      if (file[at] !== char) {
        if (isStray(char)) {
          continue
        }
        return null
      }

      if (piece.paint !== null) {
        // Whitespace between two characters of one piece is painted with them,
        // so `a b` reads as one mark. Not across a line break, or the
        // indentation of the next line would be painted too.
        const gap = previous === -1 ? '' : file.slice(previous, at)
        const from = previous !== -1 && !gap.includes('\n') ? previous : at
        paints.fill(piece.paint, from, at + 1)
      }

      kept[at] = piece.kept
      rows[at] = piece.row
      if (first === -1) {
        first = at
      }
      previous = at
      spaces = 0
      at++
    }

    if (piece.anchor === true) {
      anchors.push(first === -1 ? skipSpace(file, at) : first)
    }
  }

  // What is left of the file has to be what a formatter writes and nothing
  // else, or the view left out text the file has.
  while (at < file.length && (isSpace(file[at]) || isStray(file[at]))) {
    at++
  }

  return at === file.length ? { paints, kept, rows, anchors } : null
}

/** Runs of one class on one line, keyed by line and by the column they start at. */
function getTokens(
  file: string,
  paints: ReadonlyArray<string | null>
): ITokens {
  const tokens: ITokens = {}
  let line = 0
  let column = 0
  let at = 0

  while (at < file.length) {
    if (file[at] === '\n') {
      line++
      column = 0
      at++
      continue
    }

    const paint = paints[at]
    let end = at + 1
    while (end < file.length && file[end] !== '\n' && paints[end] === paint) {
      end++
    }

    if (paint !== null) {
      let lineTokens: ILineTokens | undefined = tokens[line]
      if (lineTokens === undefined) {
        lineTokens = {}
        tokens[line] = lineTokens
      }
      lineTokens[column] = { length: end - at, token: paint }
    }

    column += end - at
    at = end
  }

  return tokens
}

/** The lines, counted from 0, that hold text and no mark. */
function getUnmarkedLines(
  file: string,
  paints: ReadonlyArray<string | null>
): ReadonlyArray<number> {
  const lines = new Array<number>()
  let line = 0
  let hasText = false
  let hasMark = false

  for (let at = 0; at <= file.length; at++) {
    if (at === file.length || file[at] === '\n') {
      // A blank line has no text to say either way, so git keeps it.
      if (hasText && !hasMark) {
        lines.push(line)
      }
      line++
      hasText = false
      hasMark = false
      continue
    }

    hasText ||= !isSpace(file[at])
    hasMark ||= paints[at] !== null
  }

  return lines
}

/** The lines, counted from 0, whose matched text all belongs to kept lines. */
function getKeptLines(
  file: string,
  kept: ReadonlyArray<boolean | undefined>
): ReadonlyArray<number> {
  const lines = new Array<number>()
  let line = 0
  let hasText = false
  let allKept = true

  for (let at = 0; at <= file.length; at++) {
    if (at === file.length || file[at] === '\n') {
      if (hasText && allKept) {
        lines.push(line)
      }
      line++
      hasText = false
      allKept = true
      continue
    }

    const owner = kept[at]
    if (owner !== undefined) {
      hasText = true
      allKept &&= owner
    }
  }

  return lines
}

/** The line and column of an offset into the file, both counted from 0. */
function locate(
  file: string,
  offset: number
): { readonly line: number; readonly column: number } {
  let line = 0
  let lineStart = 0

  for (let at = file.indexOf('\n'); at !== -1 && at < offset; ) {
    line++
    lineStart = at + 1
    at = file.indexOf('\n', at + 1)
  }

  return { line, column: offset - lineStart }
}

/** The view row each line of the file starts on; `null` for a line with no text. */
function getLineRows(
  file: string,
  rows: ReadonlyArray<number | undefined>
): ReadonlyArray<number | null> {
  const lines = new Array<number | null>()
  let first: number | null = null

  for (let at = 0; at <= file.length; at++) {
    if (at === file.length || file[at] === '\n') {
      lines.push(first)
      first = null
      continue
    }

    first ??= rows[at] ?? null
  }

  return lines
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && isSpace(text[at])) {
    at++
  }
  return at
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char)
}

/** What the view may leave out or add where the file does not: a trailing `,` or `;`. */
function isStray(char: string): boolean {
  return char === ',' || char === ';'
}
