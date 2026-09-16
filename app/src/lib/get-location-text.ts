import * as Os from 'os'
import * as Path from 'path'
import { Repository } from '../models/repository'

/**
 * Text that another tool reads to find the commit and the file. A `null` SHA
 * means the file has uncommitted changes.
 */
export function getLocationText(
  repository: Repository,
  sha: string | null,
  filePath: string | null
) {
  const lines = [
    `Repository: ${replaceHomeDirWithTilde(repository.path)}`,
    `Commit: ${sha ?? 'uncommitted changes'}`,
  ]

  if (filePath !== null) {
    lines.push(`File: ${Path.normalize(filePath)}`)
  }

  return lines.join('\n')
}

function replaceHomeDirWithTilde(path: string) {
  const homeDir = Os.homedir()

  if (path === homeDir) {
    return '~'
  }

  return path.startsWith(homeDir + Path.sep)
    ? '~' + path.slice(homeDir.length)
    : path
}
