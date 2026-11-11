import * as Path from 'path'
import { readFile, stat } from 'fs/promises'
import { GitError } from 'dugite'
import { git } from './core'
import { NullTreeSHA } from './diff-index'
import { Repository } from '../../models/repository'

export interface ILineCounts {
  readonly added: number
  readonly deleted: number
}

/**
 * Each line is in one group only. Tests come first, then JSON, then comments,
 * then imports, so a comment in a test file is a test line.
 */
export interface ICodeLineCounts {
  readonly code: ILineCounts
  readonly tests: ILineCounts
  readonly json: ILineCounts
  readonly comments: ILineCounts
  readonly imports: ILineCounts
}

interface ICommentSyntax {
  readonly linePrefixes: ReadonlyArray<string>
  readonly blocks: ReadonlyArray<readonly [open: string, close: string]>
}

interface IImportSyntax {
  /** Finds the first line of an import statement. */
  readonly start: RegExp
  /** True when the statement continues after its first line. */
  readonly isOpenAfter: (firstLine: string) => boolean
  /** True when the statement stops at this line. */
  readonly closes: (line: string) => boolean
}

interface IFileSyntax {
  readonly comments: ICommentSyntax | null
  readonly imports: IImportSyntax | null
}

/**
 * The state of one side of a hunk at the start of its next line. Added lines
 * and removed lines each have one.
 */
interface ISideState {
  /** The marker that closes the open block comment, or null. */
  blockClose: string | null
  isInImport: boolean
}

type LineKind = 'code' | 'comment' | 'import'

interface IMutableLineCounts {
  added: number
  deleted: number
}

export async function getCodeLineCounts(
  repository: Repository,
  parentCommitish: string,
  commitish: string
): Promise<ICodeLineCounts> {
  return parseCodeLineCounts(
    await getDiff(repository, parentCommitish, commitish)
  )
}

/**
 * `git diff HEAD` does not show untracked files, so this reads them from the
 * disk.
 */
export async function getWorkingDirectoryCodeLineCounts(
  repository: Repository,
  untrackedPaths: ReadonlyArray<string>
): Promise<ICodeLineCounts> {
  const [diff, ...untrackedDiffs] = await Promise.all([
    getDiff(repository, 'HEAD', null),
    ...untrackedPaths.map(path => getUntrackedFileDiff(repository, path)),
  ])

  return parseCodeLineCounts([diff, ...untrackedDiffs].join('\n'))
}

/** Count the lines of the output of `git diff`. */
export function parseCodeLineCounts(diff: string): ICodeLineCounts {
  const code = { added: 0, deleted: 0 }
  const tests = { added: 0, deleted: 0 }
  const json = { added: 0, deleted: 0 }
  const comments = { added: 0, deleted: 0 }
  const imports = { added: 0, deleted: 0 }
  const countsByKind: Record<LineKind, IMutableLineCounts> = {
    code,
    comment: comments,
    import: imports,
  }

  let oldPath: string | null = null
  let newPath: string | null = null
  let isTest = false
  let isJson = false
  let syntax: IFileSyntax = { comments: null, imports: null }
  let isInHunk = false
  const added: ISideState = { blockClose: null, isInImport: false }
  const deleted: ISideState = { blockClose: null, isInImport: false }

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      oldPath = null
      newPath = null
      isInHunk = false
      continue
    }

    if (!isInHunk) {
      if (line.startsWith('--- ')) {
        oldPath = parseHeaderPath(line, 'a/')
      } else if (line.startsWith('+++ ')) {
        newPath = parseHeaderPath(line, 'b/')
      } else if (line.startsWith('@@')) {
        const path = newPath ?? oldPath ?? ''
        isTest = isTestFile(path)
        isJson = isJsonFile(path)
        syntax = getFileSyntax(path)
        isInHunk = true
        resetSideState(added)
        resetSideState(deleted)
      }
      continue
    }

    if (line.startsWith('@@')) {
      resetSideState(added)
      resetSideState(deleted)
      continue
    }

    const sign = line[0]
    const content = line.slice(1)

    // A context line is in both sides, so it moves the state of both sides.
    if (sign === ' ') {
      readLine(content, syntax, added)
      readLine(content, syntax, deleted)
    }

    if (sign !== '+' && sign !== '-') {
      continue
    }

    let counts: IMutableLineCounts

    if (isTest) {
      counts = tests
    } else if (isJson) {
      counts = json
    } else {
      counts =
        countsByKind[readLine(content, syntax, sign === '+' ? added : deleted)]
    }

    if (sign === '+') {
      counts.added++
    } else {
      counts.deleted++
    }
  }

  return { code, tests, json, comments, imports }
}

/**
 * With a null `commitish`, the diff is from `parentCommitish` to the working
 * directory.
 */
async function getDiff(
  repository: Repository,
  parentCommitish: string,
  commitish: string | null
): Promise<string> {
  const args = [
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-C',
    '-M',
    parentCommitish,
    ...(commitish === null ? [] : [commitish]),
    '--',
  ]

  const { stdout, gitError } = await git(args, repository.path, 'getDiff', {
    expectedErrors: new Set([GitError.BadRevision]),
  })

  // The parent ref is not valid when the oldest commit is a root commit, or
  // when HEAD has no commits yet.
  if (gitError === GitError.BadRevision && parentCommitish !== NullTreeSHA) {
    return getDiff(repository, NullTreeSHA, commitish)
  }

  return stdout
}

/** Larger untracked files are not counted, as they are most likely not code. */
const maxUntrackedFileSize = 4 * 1024 * 1024

/**
 * A diff that adds all the lines of the file. It is empty for a binary file,
 * a file that is too large, or a file that is not there anymore.
 */
async function getUntrackedFileDiff(
  repository: Repository,
  path: string
): Promise<string> {
  const fullPath = Path.join(repository.path, path)

  try {
    if ((await stat(fullPath)).size > maxUntrackedFileSize) {
      return ''
    }

    const buffer = await readFile(fullPath)

    // Git also finds binary files from a NUL byte in the first 8000 bytes.
    if (buffer.subarray(0, 8000).includes(0)) {
      return ''
    }

    return createAddedFileDiff(path, buffer.toString('utf8'))
  } catch {
    return ''
  }
}

export function createAddedFileDiff(path: string, contents: string): string {
  const lines = contents.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }

  if (lines.length === 0) {
    return ''
  }

  return [
    `diff --git a/${path} b/${path}`,
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(line => `+${line}`),
  ].join('\n')
}

const testDirectoryPattern =
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|specs?|e2e|fixtures?)\//i
const testFileNamePattern =
  /([._-](test|spec)s?\.[^/]+|^test_[^/]+\.py|^conftest\.py|[a-z0-9]Tests?\.[^./]+)$/

/** A guess from the naming conventions of common languages. */
export function isTestFile(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  return testDirectoryPattern.test(path) || testFileNamePattern.test(fileName)
}

const jsonExtensionPattern = /\.json[c5]?$/i

export function isJsonFile(path: string): boolean {
  return jsonExtensionPattern.test(path)
}

const slashes = ['//']
const hashes = ['#']
const cBlock = ['/*', '*/'] as const
const htmlBlock = ['<!--', '-->'] as const
const cLike: ICommentSyntax = { linePrefixes: slashes, blocks: [cBlock] }
const hashLike: ICommentSyntax = { linePrefixes: hashes, blocks: [] }
const markupLike: ICommentSyntax = { linePrefixes: [], blocks: [htmlBlock] }

const syntaxByExtension: ReadonlyMap<string, ICommentSyntax> = new Map([
  ...[
    'js',
    'jsx',
    'mjs',
    'cjs',
    'ts',
    'tsx',
    'mts',
    'cts',
    'java',
    'kt',
    'kts',
    'scala',
    'groovy',
    'gradle',
    'swift',
    'go',
    'rs',
    'c',
    'h',
    'cc',
    'cpp',
    'cxx',
    'hpp',
    'hh',
    'm',
    'mm',
    'cs',
    'dart',
    'zig',
    'proto',
    'sol',
    'scss',
    'less',
  ].map(e => [e, cLike] as const),
  ...[
    'sh',
    'bash',
    'zsh',
    'fish',
    'rb',
    'pl',
    'pm',
    'r',
    'ex',
    'exs',
    'yml',
    'yaml',
    'toml',
    'cmake',
    'tf',
    'nix',
    'coffee',
    'cr',
    'jl',
    'ps1',
    'properties',
    'conf',
  ].map(e => [e, hashLike] as const),
  ...['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'md'].map(
    e => [e, markupLike] as const
  ),
  ['css', { linePrefixes: [], blocks: [cBlock] }],
  ['php', { linePrefixes: ['//', '#'], blocks: [cBlock] }],
  [
    'py',
    {
      linePrefixes: hashes,
      blocks: [
        ['"""', '"""'],
        ["'''", "'''"],
      ],
    },
  ],
  ['sql', { linePrefixes: ['--'], blocks: [cBlock] }],
  ['lua', { linePrefixes: ['--'], blocks: [['--[[', ']]']] }],
  ['hs', { linePrefixes: ['--'], blocks: [['{-', '-}']] }],
  ['elm', { linePrefixes: ['--'], blocks: [['{-', '-}']] }],
  ['clj', { linePrefixes: [';'], blocks: [] }],
  ['el', { linePrefixes: [';'], blocks: [] }],
  ['lisp', { linePrefixes: [';'], blocks: [] }],
  ['ini', { linePrefixes: [';', '#'], blocks: [] }],
  ['erl', { linePrefixes: ['%'], blocks: [] }],
  ['tex', { linePrefixes: ['%'], blocks: [] }],
])

const syntaxByFileName: ReadonlyMap<string, ICommentSyntax> = new Map([
  ['dockerfile', hashLike],
  ['makefile', hashLike],
  ['gemfile', hashLike],
  ['rakefile', hashLike],
  ['podfile', hashLike],
  ['.gitignore', hashLike],
  ['.gitattributes', hashLike],
  ['.env', hashLike],
])

/**
 * `import a from 'b'`, `import type { A } from 'b'`, and `import 'b'`. A
 * multi-line import stops at the line with the module name. `import('b')` and
 * `import.meta` are not imports.
 */
const javaScriptImports: IImportSyntax = {
  start: /^import(\s|[{*'"])/,
  isOpenAfter: line =>
    line.includes('{') && !line.includes('}') && !/['"]/.test(line),
  closes: line => /['"]/.test(line),
}

/** `use a::b;`, `pub(crate) use a::{b, c};`, and `extern crate a;`. */
const rustImports: IImportSyntax = {
  start: /^((pub(\([^)]*\))?\s+)?use\s|extern\s+crate\s)/,
  isOpenAfter: line => !line.includes(';'),
  closes: line => line.includes(';'),
}

/** `import Foundation`, `@testable import App`, and `import struct A.B`. */
const swiftImports: IImportSyntax = {
  start: /^(@\w+\s+)*import\s/,
  isOpenAfter: () => false,
  closes: () => true,
}

const importSyntaxByExtension: ReadonlyMap<string, IImportSyntax> = new Map([
  ...['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].map(
    e => [e, javaScriptImports] as const
  ),
  ['rs', rustImports],
  ['swift', swiftImports],
])

function getFileSyntax(path: string): IFileSyntax {
  const fileName = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const byName = syntaxByFileName.get(fileName)
  if (byName !== undefined) {
    return { comments: byName, imports: null }
  }

  const dot = fileName.lastIndexOf('.')
  const extension = dot === -1 ? null : fileName.slice(dot + 1)
  return extension === null
    ? { comments: null, imports: null }
    : {
        comments: syntaxByExtension.get(extension) ?? null,
        imports: importSyntaxByExtension.get(extension) ?? null,
      }
}

/** Find the kind of a line and move the state of its side to the next line. */
function readLine(
  content: string,
  syntax: IFileSyntax,
  state: ISideState
): LineKind {
  if (syntax.comments !== null) {
    const result = readCommentLine(content, syntax.comments, state.blockClose)
    state.blockClose = result.blockClose

    if (result.isComment) {
      return 'comment'
    }
  }

  if (syntax.imports === null) {
    return 'code'
  }

  const text = content.trim()

  if (state.isInImport) {
    state.isInImport = !syntax.imports.closes(text)
    return 'import'
  }

  if (!syntax.imports.start.test(text)) {
    return 'code'
  }

  state.isInImport = syntax.imports.isOpenAfter(text)
  return 'import'
}

/** A new hunk starts with an unknown state, so it has no open statements. */
function resetSideState(state: ISideState) {
  state.blockClose = null
  state.isInImport = false
}

/**
 * `blockClose` is the marker that closes the block comment the line is in, or
 * null. The result gives the marker for the next line of the same side.
 *
 * A block comment that starts before the context of a hunk is unknown. A
 * C-style line that starts with `*` is still a comment.
 */
function readCommentLine(
  content: string,
  syntax: ICommentSyntax,
  blockClose: string | null
): { readonly isComment: boolean; readonly blockClose: string | null } {
  const text = content.trim()

  if (blockClose !== null) {
    const end = text.indexOf(blockClose)
    return end === -1
      ? { isComment: true, blockClose }
      : {
          isComment: text.slice(end + blockClose.length).trim() === '',
          blockClose: null,
        }
  }

  for (const [open, close] of syntax.blocks) {
    if (!text.startsWith(open)) {
      continue
    }

    const rest = text.slice(open.length)
    const end = rest.indexOf(close)
    return end === -1
      ? { isComment: true, blockClose: close }
      : {
          isComment: rest.slice(end + close.length).trim() === '',
          blockClose: null,
        }
  }

  if (syntax.linePrefixes.some(prefix => text.startsWith(prefix))) {
    return { isComment: true, blockClose: null }
  }

  const isCBlockLine =
    syntax.blocks.includes(cBlock) &&
    (text === '*' || text.startsWith('* ') || text.startsWith('*/'))

  return { isComment: isCBlockLine, blockClose: null }
}

/** The path in a `---` or `+++` header line, or null for `/dev/null`. */
function parseHeaderPath(line: string, prefix: string): string | null {
  let path = line.slice(4)
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1)
  }

  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}
