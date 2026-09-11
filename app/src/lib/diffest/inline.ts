import { ILineTokens } from '../highlighter/types'
import type { IInlineDeletion } from './tokens'

/**
 * A new line with the text Diffest reports as removed from it put back in,
 * painted as deleted, just before what replaced it. This is how Diffest's own
 * page draws a changed line: once, with the old text and the new side by side.
 *
 * Every token after an inserted text moves right by its length. A token that
 * an insertion falls inside is cut in two around it.
 */
export function withInlineDeletions(
  content: string,
  layers: ReadonlyArray<ILineTokens>,
  deletions: ReadonlyArray<IInlineDeletion>
): { readonly content: string; readonly tokens: ReadonlyArray<ILineTokens> } {
  const sorted = [...deletions].sort((a, b) => a.column - b.column)
  const inserted: ILineTokens = {}
  let text = ''
  let from = 0
  let shift = 0

  for (const { column, text: removed } of sorted) {
    text += content.slice(from, column) + removed
    inserted[column + shift] = { length: removed.length, token: 'df-deleted' }
    shift += removed.length
    from = column
  }
  text += content.slice(from)

  return {
    content: text,
    tokens: [...layers.map(layer => shiftLayer(layer, sorted)), inserted],
  }
}

function shiftLayer(
  layer: ILineTokens,
  deletions: ReadonlyArray<IInlineDeletion>
): ILineTokens {
  const shifted: ILineTokens = {}

  // Text inserted at a column goes in front of the character there, so a
  // token that starts at that column moves with the rest.
  const shiftAt = (column: number) =>
    deletions
      .filter(deletion => deletion.column <= column)
      .reduce((sum, deletion) => sum + deletion.text.length, 0)

  for (const key in layer) {
    const start = Number(key)
    const { length, token } = layer[key]
    const end = start + length
    let pieceStart = start

    for (const { column } of deletions) {
      if (column > pieceStart && column < end) {
        shifted[pieceStart + shiftAt(pieceStart)] = {
          length: column - pieceStart,
          token,
        }
        pieceStart = column
      }
    }

    shifted[pieceStart + shiftAt(pieceStart)] = {
      length: end - pieceStart,
      token,
    }
  }

  return shifted
}
