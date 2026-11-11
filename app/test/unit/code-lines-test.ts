import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  createAddedFileDiff,
  isTestFile,
  parseCodeLineCounts,
} from '../../src/lib/git/code-lines'

function fileDiff(path: string, hunks: ReadonlyArray<string>) {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks,
  ].join('\n')
}

describe('parseCodeLineCounts', () => {
  it('puts the lines into code, tests, and comments', () => {
    const diff = [
      fileDiff('src/a.ts', [
        '@@ -1,2 +1,3 @@',
        '-const a = 1',
        '-// old comment',
        '+const a = 2',
        '+// new comment',
        '+/** doc */',
      ]),
      fileDiff('src/a.test.ts', [
        '@@ -1 +1,2 @@',
        '-it()',
        '+it()',
        '+// test comment',
      ]),
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 1, deleted: 1 },
      tests: { added: 2, deleted: 1 },
      json: { added: 0, deleted: 0 },
      comments: { added: 2, deleted: 1 },
      imports: { added: 0, deleted: 0 },
    })
  })

  it('puts the lines of a JSON file into their own group', () => {
    const diff = [
      fileDiff('package.json', [
        '@@ -2 +2,2 @@',
        '-  "a": 1',
        '+  "a": 2',
        '+  "b": 3',
      ]),
      fileDiff('tsconfig.jsonc', ['@@ -0,0 +1 @@', '+// a comment']),
      fileDiff('test/fixture.json', ['@@ -0,0 +1 @@', '+{}']),
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 0, deleted: 0 },
      tests: { added: 1, deleted: 0 },
      json: { added: 3, deleted: 1 },
      comments: { added: 0, deleted: 0 },
      imports: { added: 0, deleted: 0 },
    })
  })

  it('puts the imports of TypeScript, Rust, and Swift into their own group', () => {
    const diff = [
      fileDiff('src/a.ts', [
        '@@ -1,2 +1,10 @@',
        "-import a from 'a'",
        "+import a, { b } from 'a'",
        "+import type { C } from 'c'",
        "+import 'side-effect'",
        '+import {',
        '+  d,',
        '+  // why d',
        '+  e,',
        "+} from 'd'",
        "+const f = await import('f')",
        ' run()',
      ]),
      fileDiff('src/lib.rs', [
        '@@ -0,0 +1,7 @@',
        '+use std::fmt;',
        '+pub(crate) use crate::a::{',
        '+    b,',
        '+    c,',
        '+};',
        '+extern crate d;',
        '+fn main() {}',
      ]),
      fileDiff('App/View.swift', [
        '@@ -0,0 +1,3 @@',
        '+import SwiftUI',
        '+@testable import App',
        '+struct View {}',
      ]),
      fileDiff('main.py', ['@@ -0,0 +1 @@', '+import os']),
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 4, deleted: 0 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 1, deleted: 0 },
      imports: { added: 15, deleted: 1 },
    })
  })

  it('finds the start of a multi-line import in the context lines', () => {
    const diff = fileDiff('a.tsx', [
      '@@ -1,4 +1,4 @@',
      ' import {',
      '-  a,',
      '+  b,',
      " } from 'x'",
      '+run()',
    ])

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 1, deleted: 0 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 0, deleted: 0 },
      imports: { added: 1, deleted: 1 },
    })
  })

  it('puts the imports of a test file into tests', () => {
    const diff = fileDiff('src/a.test.ts', [
      '@@ -0,0 +1 @@',
      "+import a from 'a'",
    ])

    assert.deepStrictEqual(parseCodeLineCounts(diff).tests, {
      added: 1,
      deleted: 0,
    })
  })

  it('follows a block comment across lines of the same side', () => {
    const diff = fileDiff('a.js', [
      '@@ -0,0 +1,5 @@',
      '+/*',
      '+ text without a star',
      '+*/',
      '+/* a */ run()',
      '+run()',
    ])

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 2, deleted: 0 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 3, deleted: 0 },
      imports: { added: 0, deleted: 0 },
    })
  })

  it('counts the inner lines of a block comment that starts before the hunk', () => {
    const diff = fileDiff('a.go', ['@@ -4 +4 @@', '- * old', '+ * new'])

    assert.deepStrictEqual(parseCodeLineCounts(diff).comments, {
      added: 1,
      deleted: 1,
    })
  })

  it('finds the start of a block comment in the context lines', () => {
    const diff = fileDiff('a.css', [
      '@@ -1,3 +1,3 @@',
      ' /*',
      '-old text',
      '+new text',
      ' */',
      ' a { color: red; }',
      '+b { color: blue; }',
    ])

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 1, deleted: 0 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 1, deleted: 1 },
      imports: { added: 0, deleted: 0 },
    })
  })

  it('reads removed lines that look like header lines', () => {
    const diff = fileDiff('q.sql', [
      '@@ -1,2 +0,0 @@',
      '--- a comment',
      '-+++ code',
    ])

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 0, deleted: 1 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 0, deleted: 1 },
      imports: { added: 0, deleted: 0 },
    })
  })

  it('uses the old path for a deleted file', () => {
    const diff = [
      'diff --git a/test/old.py b/test/old.py',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/test/old.py',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-assert True',
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff).tests, {
      added: 0,
      deleted: 1,
    })
  })

  it('counts every line as code when the language is unknown', () => {
    const diff = fileDiff('notes.txt', ['@@ -0,0 +1 @@', '+// not a comment'])

    assert.deepStrictEqual(parseCodeLineCounts(diff).code, {
      added: 1,
      deleted: 0,
    })
  })

  it('ignores binary files', () => {
    const diff = [
      'diff --git a/a.png b/a.png',
      'index 1111111..2222222 100644',
      'Binary files a/a.png and b/a.png differ',
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 0, deleted: 0 },
      tests: { added: 0, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 0, deleted: 0 },
      imports: { added: 0, deleted: 0 },
    })
  })
})

describe('isTestFile', () => {
  it('finds test files of common languages', () => {
    for (const path of [
      'app/test/unit/diffest-rows-test.ts',
      'src/a.test.tsx',
      'src/a.spec.js',
      'src/__tests__/a.js',
      'pkg/a_test.go',
      'tests/test_a.py',
      'test_a.py',
      'conftest.py',
      'src/test/java/AppTest.java',
      'Tests/AppTests.swift',
    ]) {
      assert.strictEqual(isTestFile(path), true, path)
    }
  })

  it('does not take other files for test files', () => {
    for (const path of [
      'src/latest.ts',
      'src/contest/a.ts',
      'src/testimonials.tsx',
      'src/Test.java',
      'src/attest.py',
    ]) {
      assert.strictEqual(isTestFile(path), false, path)
    }
  })
})

describe('createAddedFileDiff', () => {
  it('adds each line of the file', () => {
    const diff = [
      createAddedFileDiff('src/a.ts', '// comment\nconst a = 1\n\n'),
      createAddedFileDiff('src/a.test.ts', 'it()'),
      createAddedFileDiff('src/empty.ts', ''),
    ].join('\n')

    assert.deepStrictEqual(parseCodeLineCounts(diff), {
      code: { added: 2, deleted: 0 },
      tests: { added: 1, deleted: 0 },
      json: { added: 0, deleted: 0 },
      comments: { added: 1, deleted: 0 },
      imports: { added: 0, deleted: 0 },
    })
  })
})
