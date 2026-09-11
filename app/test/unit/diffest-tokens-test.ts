import { describe, it } from 'node:test'
import assert from 'node:assert'
import diff from 'diffest'
import type { DiffLine, DiffView, Segment } from 'diffest'
import { ITokens } from '../../src/lib/highlighter/types'
import { IDiffestTokens, tokensFromView } from '../../src/lib/diffest/tokens'
import { withInlineDeletions } from '../../src/lib/diffest/inline'

function line(...segments: Segment[]): DiffLine {
  return { segments }
}

function same(text: string): Segment {
  return { kind: 'same', text }
}

function changed(before: string, after: string, carried = false): Segment {
  return { kind: 'changed', before, after, carried }
}

/** The class painted on a character of the file, if any. */
function paintAt(
  tokens: ITokens,
  lineNumber: number,
  column: number
): string | undefined {
  const lineTokens = tokens[lineNumber] ?? {}
  for (const start in lineTokens) {
    const token = lineTokens[start]
    if (column >= Number(start) && column < Number(start) + token.length) {
      return token.token
    }
  }
  return undefined
}

/** The marks alone, without the list of lines Diffest reads as kept. */
function marks(tokens: IDiffestTokens | null) {
  return tokens === null ? null : { before: tokens.before, after: tokens.after }
}

describe('tokensFromView', () => {
  it('paints the old half of a change as deleted and the new half as changed', () => {
    const view: DiffView = [line(same('const rate = '), changed('2', '3'))]

    const tokens = tokensFromView(view, 'const rate = 2', 'const rate = 3')

    assert.deepStrictEqual(marks(tokens), {
      before: { 0: { 13: { length: 1, token: 'df-deleted' } } },
      after: { 0: { 13: { length: 1, token: 'df-changed' } } },
    })
  })

  // Diffest writes a block back onto one line when the break has nothing to
  // paint, so the view has one line where the file has four.
  it('places a mark on the file line, not on the view line', () => {
    const view: DiffView = [
      line(same('call(a, '), changed('b', 'c'), same(')')),
    ]

    const tokens = tokensFromView(
      view,
      'call(\n  a,\n  b\n)',
      'call(\n  a,\n  c\n)'
    )

    assert.deepStrictEqual(tokens?.before, {
      2: { 2: { length: 1, token: 'df-deleted' } },
    })
    assert.deepStrictEqual(tokens?.after, {
      2: { 2: { length: 1, token: 'df-changed' } },
    })
  })

  it('skips a trailing comma the view does not keep', () => {
    const view: DiffView = [line(same('f('), changed('a', 'b'), same(')'))]

    const tokens = tokensFromView(view, 'f(\n  a,\n)', 'f(\n  b,\n)')

    assert.strictEqual(paintAt(tokens!.before, 1, 2), 'df-deleted')
    assert.strictEqual(paintAt(tokens!.after, 1, 2), 'df-changed')
  })

  it('paints whitespace inside a mark, but not the indentation after a break', () => {
    const view: DiffView = [
      line(same('x('), { kind: 'added', text: 'a, b' }, same(')')),
    ]

    const tokens = tokensFromView(view, 'x()', 'x(a,\n  b)')

    assert.deepStrictEqual(tokens?.after, {
      0: { 2: { length: 2, token: 'df-added' } },
      1: { 2: { length: 1, token: 'df-added' } },
    })
  })

  it('paints nothing for a quiet mark', () => {
    const view: DiffView = [
      line(same('a'), { kind: 'added', text: ' b', quiet: true }),
    ]

    const tokens = tokensFromView(view, 'a', 'a b')

    assert.deepStrictEqual(marks(tokens), { before: {}, after: {} })
  })

  it('paints a carried change only where it landed', () => {
    const view: DiffView = [
      line(same('x '), changed('p', 'q', true), {
        kind: 'deleted',
        text: ' p',
        quiet: true,
      }),
    ]

    const tokens = tokensFromView(view, 'x  p', 'x q')

    assert.deepStrictEqual(marks(tokens), {
      before: {},
      after: { 0: { 2: { length: 1, token: 'df-changed' } } },
    })
  })

  it('gives both ends of a move the same pair class', () => {
    const view: DiffView = [
      { segments: [same('b()')], move: { end: 'to' } },
      line(same('a()')),
      { segments: [same('b()')], move: { end: 'from' } },
    ]

    const tokens = tokensFromView(view, 'a()\nb()', 'b()\na()')

    assert.deepStrictEqual(marks(tokens), {
      before: {
        1: { 0: { length: 3, token: 'df-moved df-moved-from df-m-0' } },
      },
      after: { 0: { 0: { length: 3, token: 'df-moved df-m-0' } } },
    })
  })

  it('declines a view whose text is not the text of the file', () => {
    const view: DiffView = [line(same('abc'))]

    assert.strictEqual(tokensFromView(view, 'abd', 'abc'), null)
  })

  it('declines a view that leaves out text the file has', () => {
    const view: DiffView = [line(same('abc'))]

    assert.strictEqual(tokensFromView(view, 'abc\nmore', 'abc'), null)
  })

  it('places what the real algorithm marks', () => {
    const before = 'const a = 1\nconst rate = 2\n'
    const after = 'const a = 1\nconst rate = 3\n'

    const tokens = tokensFromView(diff(before, after, '.ts'), before, after)

    assert.notStrictEqual(tokens, null)
    assert.strictEqual(paintAt(tokens!.after, 1, 13), 'df-changed')
    assert.strictEqual(paintAt(tokens!.after, 0, 6), undefined)
  })

  it('reports an old line with no mark as kept', () => {
    const view: DiffView = [
      line(
        same('function f(a: A'),
        { kind: 'added', text: ', b: B' },
        same('): R {')
      ),
    ]

    const tokens = tokensFromView(
      view,
      'function f(a: A): R {',
      'function f(a: A, b: B): R {'
    )

    assert.deepStrictEqual(tokens?.unmarkedBeforeLines, [0])
  })

  // Hiding this row would hide the `2` that went.
  it('does not report an old line that holds a mark', () => {
    const view: DiffView = [line(same('const rate = '), changed('2', '3'))]

    const tokens = tokensFromView(view, 'const rate = 2', 'const rate = 3')

    assert.deepStrictEqual(tokens?.unmarkedBeforeLines, [])
  })

  it('does not report a blank old line', () => {
    const view: DiffView = [line(same('a')), line(same('')), line(same('b'))]

    const tokens = tokensFromView(view, 'a\n\nb', 'a\n\nb')

    assert.deepStrictEqual(tokens?.unmarkedBeforeLines, [0, 2])
  })

  // Git shows the old signature as deleted and the new one as added. Diffest
  // shows one line that gained a parameter.
  it('keeps the old line of a signature that gained a parameter', () => {
    const before =
      'function deriveState(parsed: ParsedTranscript, now: number): AgentState {\n  return state\n}\n'
    const after =
      'function deriveState(parsed: ParsedTranscript, now: number, promptOpen: boolean): AgentState {\n  return state\n}\n'

    const tokens = tokensFromView(diff(before, after, '.ts'), before, after)

    assert.ok(tokens?.unmarkedBeforeLines.includes(0))
  })

  // Git shows the old line and the new line. Diffest shows one line, with
  // `order` removed just before `unsorted`, and `.push(item.cwd);` once.
  it('puts the text removed from a changed line into the new line', () => {
    const before = '  order.push(item.cwd);\n'
    const after = '  unsorted.push(item.cwd);\n'

    const tokens = tokensFromView(diff(before, after, '.ts'), before, after)

    assert.deepStrictEqual(tokens?.keptBeforeLines, [0])
    assert.deepStrictEqual(tokens?.inlineDeletions, [
      { beforeLine: 0, afterLine: 0, column: 2, text: 'order' },
    ])
  })

  it('puts removed text after the whitespace before it', () => {
    const view: DiffView = [line(same('x = '), changed('2', '3'))]

    const tokens = tokensFromView(view, 'x = 2', 'x = 3')

    assert.deepStrictEqual(tokens?.inlineDeletions, [
      { beforeLine: 0, afterLine: 0, column: 4, text: '2' },
    ])
  })

  it('puts a deletion where it was removed from', () => {
    const view: DiffView = [
      line(same('foo('), { kind: 'deleted', text: 'a, ' }, same('b)')),
    ]

    const tokens = tokensFromView(view, 'foo(a, b)', 'foo(b)')

    assert.deepStrictEqual(tokens?.keptBeforeLines, [0])
    assert.deepStrictEqual(tokens?.inlineDeletions, [
      { beforeLine: 0, afterLine: 0, column: 4, text: 'a, ' },
    ])
  })

  // A deleted line has a row of its own, so its text goes nowhere else.
  it('does not keep a line Diffest reports as deleted', () => {
    const view: DiffView = [
      line({ kind: 'deleted', text: 'gone()' }),
      line(same('kept()')),
    ]

    const tokens = tokensFromView(view, 'gone()\nkept()', 'kept()')

    assert.deepStrictEqual(tokens?.keptBeforeLines, [1])
    assert.deepStrictEqual(tokens?.inlineDeletions, [])
  })
})

describe('withInlineDeletions', () => {
  it('puts removed text in and moves the tokens after it', () => {
    const { content, tokens } = withInlineDeletions(
      'unsorted.push(item.cwd);',
      [
        {
          0: { length: 8, token: 'df-changed' },
          9: { length: 4, token: 'fn' },
        },
      ],
      [{ beforeLine: 0, afterLine: 0, column: 0, text: 'order' }]
    )

    assert.strictEqual(content, 'orderunsorted.push(item.cwd);')
    assert.deepStrictEqual(tokens, [
      { 5: { length: 8, token: 'df-changed' }, 14: { length: 4, token: 'fn' } },
      { 0: { length: 5, token: 'df-deleted' } },
    ])
  })

  it('cuts a token that removed text goes inside', () => {
    const { content, tokens } = withInlineDeletions(
      'abcdef',
      [{ 0: { length: 6, token: 'string' } }],
      [{ beforeLine: 0, afterLine: 0, column: 3, text: 'XY' }]
    )

    assert.strictEqual(content, 'abcXYdef')
    assert.deepStrictEqual(tokens, [
      { 0: { length: 3, token: 'string' }, 5: { length: 3, token: 'string' } },
      { 3: { length: 2, token: 'df-deleted' } },
    ])
  })
})
