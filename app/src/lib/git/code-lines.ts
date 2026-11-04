import { GitError } from 'dugite'
import { git } from './core'
import { NullTreeSHA } from './diff-index'
import { Repository } from '../../models/repository'

export interface ILineCounts {
  readonly added: number
  readonly deleted: number
}

/** A line in a test file is a test line, also when it is a comment. */
export interface ICodeLineCounts {
  readonly code: ILineCounts
  readonly tests: ILineCounts
  readonly comments: ILineCounts
}

interface ICommentSyntax {
  readonly linePrefixes: ReadonlyArray<string>
  readonly blocks: ReadonlyArray<readonly [open: string, close: string]>
}

interface IMutableLineCounts {
  added: number
  deleted: number
}

export async function getCodeLineCounts(
  repository: Repository,
  parentCommitish: string,
  commitish: string
): Promise<ICodeLineCounts> {
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
    commitish,
    '--',
  ]

  const { stdout, gitError } = await git(
    args,
    repository.path,
    'getCodeLineCounts',
    { expectedErrors: new Set([GitError.BadRevision]) }
  )

  // The parent ref is not valid when the oldest commit is a root commit.
  if (gitError === GitError.BadRevision && parentCommitish !== NullTreeSHA) {
    return getCodeLineCounts(repository, NullTreeSHA, commitish)
  }

  return parseCodeLineCounts(stdout)
}

/** Count the lines of the output of `git diff`. */
export function parseCodeLineCounts(diff: string): ICodeLineCounts {
  const code = { added: 0, deleted: 0 }
  const tests = { added: 0, deleted: 0 }
  const comments = { added: 0, deleted: 0 }

  let oldPath: string | null = null
  let newPath: string | null = null
  let isTest = false
  let syntax: ICommentSyntax | null = null
  let isInHunk = false
  let addedBlockClose: string | null = null
  let deletedBlockClose: string | null = null

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
        syntax = getCommentSyntax(path)
        isInHunk = true
        addedBlockClose = null
        deletedBlockClose = null
      }
      continue
    }

    if (line.startsWith('@@')) {
      addedBlockClose = null
      deletedBlockClose = null
      continue
    }

    const sign = line[0]
    const content = line.slice(1)

    // A context line is in both sides, so it moves the block comment state of
    // both sides.
    if (sign === ' ' && syntax !== null) {
      addedBlockClose = readCommentLine(
        content,
        syntax,
        addedBlockClose
      ).blockClose
      deletedBlockClose = readCommentLine(
        content,
        syntax,
        deletedBlockClose
      ).blockClose
    }

    if (sign !== '+' && sign !== '-') {
      continue
    }

    let counts: IMutableLineCounts = code

    if (isTest) {
      counts = tests
    } else if (syntax !== null) {
      const blockClose = sign === '+' ? addedBlockClose : deletedBlockClose
      const result = readCommentLine(content, syntax, blockClose)

      if (sign === '+') {
        addedBlockClose = result.blockClose
      } else {
        deletedBlockClose = result.blockClose
      }

      if (result.isComment) {
        counts = comments
      }
    }

    if (sign === '+') {
      counts.added++
    } else {
      counts.deleted++
    }
  }

  return { code, tests, comments }
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
    'jsonc',
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

/** The comment markers for a path, or null when its language is unknown. */
function getCommentSyntax(path: string): ICommentSyntax | null {
  const fileName = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const byName = syntaxByFileName.get(fileName)
  if (byName !== undefined) {
    return byName
  }

  const dot = fileName.lastIndexOf('.')
  return dot === -1
    ? null
    : syntaxByExtension.get(fileName.slice(dot + 1)) ?? null
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
