import { describe, it } from 'node:test'
import assert from 'node:assert'
import diff from 'diffest'
import type { DiffLine, DiffView, Segment } from 'diffest'
import { DiffHunkExpansionType } from '../../src/models/diff'
import { DiffRowType, SimplifiedDiffRow } from '../../src/ui/diff/diff-helpers'
import { withDiffestRows } from '../../src/ui/diff/diffest-rows'
import { tokensFromView } from '../../src/lib/diffest/tokens'
import type { IDiffestTokens } from '../../src/lib/diffest/tokens'

function data(lineNumber: number) {
  return {
    content: `line ${lineNumber}`,
    lineNumber,
    diffLineNumber: lineNumber,
    noNewLineIndicator: false,
    tokens: [],
  }
}

function deleted(lineNumber: number): SimplifiedDiffRow {
  return { type: DiffRowType.Deleted, data: data(lineNumber), hunkStartLine: 1 }
}

function added(lineNumber: number): SimplifiedDiffRow {
  return { type: DiffRowType.Added, data: data(lineNumber), hunkStartLine: 1 }
}

function modified(before: number, after: number): SimplifiedDiffRow {
  return {
    type: DiffRowType.Modified,
    beforeData: data(before),
    afterData: data(after),
    hunkStartLine: 1,
  }
}

function context(before: number, after: number): SimplifiedDiffRow {
  return {
    type: DiffRowType.Context,
    content: `line ${after}`,
    beforeLineNumber: before,
    afterLineNumber: after,
    beforeTokens: [],
    afterTokens: [],
  }
}

const hunk: SimplifiedDiffRow = {
  type: DiffRowType.Hunk,
  content: '@@',
  expansionType: DiffHunkExpansionType.None,
  hunkIndex: 0,
}

/** Only where Diffest's view puts each line; nothing hidden or put inline. */
function overlay(
  beforeLineRows: ReadonlyArray<number | null>,
  afterLineRows: ReadonlyArray<number | null>,
  unmarkedBeforeLines: ReadonlyArray<number> = []
): IDiffestTokens {
  return {
    before: {},
    after: {},
    unmarkedBeforeLines,
    keptBeforeLines: [],
    inlineDeletions: [],
    beforeLineRows,
    afterLineRows,
  }
}

/** `-3` an old line, `+3` a new one, `3|4` a pair, `=4` context, `@@` a hunk. */
function describeRows(rows: ReadonlyArray<SimplifiedDiffRow>) {
  return rows.map(row => {
    switch (row.type) {
      case DiffRowType.Deleted:
        return `-${row.data.lineNumber}`
      case DiffRowType.Added:
        return `+${row.data.lineNumber}`
      case DiffRowType.Modified:
        return `${row.beforeData.lineNumber}|${row.afterData.lineNumber}`
      case DiffRowType.Context:
        return `=${row.afterLineNumber}`
      case DiffRowType.Hunk:
        return '@@'
    }
  })
}

describe('withDiffestRows', () => {
  it('puts removed lines where Diffest puts them, not first', () => {
    const rows = [
      deleted(1),
      deleted(2),
      deleted(3),
      ...[1, 2, 3, 4, 5, 6].map(added),
    ]

    const { rows: shown } = withDiffestRows(
      rows,
      overlay([5, 6, 7], [0, 1, 2, 3, 4, 8]),
      false
    )

    assert.deepStrictEqual(describeRows(shown), [
      '+1',
      '+2',
      '+3',
      '+4',
      '+5',
      '-1',
      '-2',
      '-3',
      '+6',
    ])
  })

  it('puts an old line before a new one on the same view line', () => {
    const { rows: shown } = withDiffestRows(
      [added(1), deleted(1)],
      overlay([0], [0]),
      false
    )

    assert.deepStrictEqual(describeRows(shown), ['-1', '+1'])
  })

  it('keeps a blank line beside the line before it', () => {
    const rows = [deleted(1), deleted(2), deleted(3), added(1), added(2)]

    const { rows: shown } = withDiffestRows(
      rows,
      overlay([1, null, 3], [0, 2]),
      false
    )

    assert.deepStrictEqual(describeRows(shown), ['+1', '-1', '-2', '+2', '-3'])
  })

  it('never moves a row past a hunk header', () => {
    const rows = [hunk, deleted(1), added(1), hunk, deleted(5), added(5)]

    const { rows: shown } = withDiffestRows(
      rows,
      overlay([1, null, null, null, 9], [0, null, null, null, 8]),
      false
    )

    assert.deepStrictEqual(describeRows(shown), [
      '@@',
      '+1',
      '-1',
      '@@',
      '+5',
      '-5',
    ])
  })

  // Git pairs the old line with the first new one. Diffest puts it on one view
  // line with the second.
  it('pairs lines side by side the way Diffest pairs them', () => {
    const { rows: shown } = withDiffestRows(
      [modified(1, 1), added(2)],
      overlay([5], [3, 5]),
      true
    )

    assert.deepStrictEqual(describeRows(shown), ['+1', '1|2'])
  })

  it('hides a lone old line with no mark in Split', () => {
    const { rows: shown } = withDiffestRows(
      [context(1, 1), deleted(2), added(2)],
      overlay([0, 1], [0, 2], [1]),
      true
    )

    assert.deepStrictEqual(describeRows(shown), ['=1', '+2'])
  })

  // The change that asked for this. Git lists all five old lines, then all the
  // new ones. Diffest keeps the head and the return, each on one row with its
  // removed text, and puts the removed rest of the call right after its head.
  it('shows a rewritten function the way Diffest does', () => {
    const before = [
      'function cleanUserText(text: string): string | null {',
      '  const withCommand = text.replace(',
      '    /<command-message>([\\s\\S]*?)<\\/command-message>\\s*/,',
      '    (_, name: string) => (name.trim() ? `/${name.trim()} ` : ""),',
      '  );',
      '  return stripIdeTags(withCommand) || null;',
      '}',
      '',
    ].join('\n')
    const after = [
      'function cleanUserText(text: string): string | null {',
      '  // Claude Code writes this note before the entries of a local command. The',
      '  // user did not type it.',
      '  if (text.startsWith("<local-command-caveat>")) return null;',
      '  // A slash command arrives as <command-message>, <command-name>, and',
      '  // <command-args> tags. Show it the way the user typed it.',
      '  const command = tagContent(text, "command-name");',
      '  const prompt = command === null ? text : `${command} ${tagContent(text, "command-args") ?? ""}`;',
      '  return stripIdeTags(prompt) || null;',
      '}',
      '',
    ].join('\n')
    const tokens = tokensFromView(diff(before, after, '.ts'), before, after)
    assert.ok(tokens !== null)

    const rows = [
      context(1, 1),
      ...[2, 3, 4, 5, 6].map(deleted),
      ...[2, 3, 4, 5, 6, 7, 8, 9].map(added),
      context(7, 10),
    ]

    const { rows: shown, inline } = withDiffestRows(rows, tokens, false)

    assert.deepStrictEqual(describeRows(shown), [
      '=1',
      '+2',
      '+3',
      '+4',
      '+5',
      '+6',
      '+7',
      '-3',
      '-4',
      '-5',
      '+8',
      '+9',
      '=10',
    ])
    // `withCommand` goes in front of `command`, and in front of `prompt`.
    assert.deepStrictEqual([...inline.keys()].sort(), [6, 8])
  })
})

describe('tokensFromView line rows', () => {
  function line(...segments: Segment[]): DiffLine {
    return { segments }
  }

  it('gives each line the view row it starts on', () => {
    const view: DiffView = [
      line({ kind: 'same', text: 'a' }),
      line({ kind: 'deleted', text: 'b' }),
      line({ kind: 'same', text: '' }),
      line({ kind: 'same', text: 'c' }),
    ]

    const tokens = tokensFromView(view, 'a\nb\n\nc', 'a\n\nc')

    assert.deepStrictEqual(tokens?.beforeLineRows, [0, 1, null, 3])
    assert.deepStrictEqual(tokens?.afterLineRows, [0, null, 3])
  })
})
