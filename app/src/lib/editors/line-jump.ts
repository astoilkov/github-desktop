/**
 * Editors that expose a custom URL scheme capable of opening a file at a
 * specific line. Keyed by the editor name as declared in the per-platform
 * editor lists (darwin.ts/win32.ts/linux.ts).
 *
 * On macOS editors are launched via `open -a <bundle>`, which cannot forward a
 * line number, so a URL scheme is the only reliable way to jump to a line. The
 * same schemes work on Windows/Linux when the editor registers its handler.
 */
const editorURLSchemes = new Map<string, string>([
  ['Visual Studio Code', 'vscode'],
  ['Visual Studio Code (Insiders)', 'vscode-insiders'],
  ['VSCodium', 'vscodium'],
  ['Cursor', 'cursor'],
  ['Windsurf', 'windsurf'],
  ['Zed', 'zed'],
])

/**
 * Build a URL that opens the given file at the given line in the editor, or
 * null if the editor has no known line-jumping URL scheme (in which case the
 * caller should fall back to opening the file without a line number).
 */
export function getEditorLineJumpURL(
  editorName: string,
  fullPath: string,
  lineNumber: number
): string | null {
  const scheme = editorURLSchemes.get(editorName)
  if (scheme === undefined) {
    return null
  }

  // Windows paths use backslashes and lack a leading slash (e.g. `C:\foo`); the
  // `file` authority in these schemes expects a POSIX-style, slash-prefixed path.
  const posixPath = fullPath.replace(/\\/g, '/')
  const rootedPath = posixPath.startsWith('/') ? posixPath : `/${posixPath}`

  return `${scheme}://file${encodeURI(rootedPath)}:${lineNumber}:1`
}
