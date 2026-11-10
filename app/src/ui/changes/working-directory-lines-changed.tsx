import * as React from 'react'
import { Repository } from '../../models/repository'
import { AppFileStatusKind, WorkingDirectoryStatus } from '../../models/status'
import {
  getWorkingDirectoryCodeLineCounts,
  ICodeLineCounts,
} from '../../lib/git/code-lines'
import { LinesChanged } from '../history/lines-changed'

interface IWorkingDirectoryLinesChangedProps {
  readonly repository: Repository
  readonly workingDirectory: WorkingDirectoryStatus
}

interface IWorkingDirectoryLinesChangedState {
  /** Goes up by one each time the counts load, so the tooltip gets them. */
  readonly loadCount: number
  readonly counts: ICodeLineCounts | null
}

/**
 * Unlike for a commit, the counts load with each change of the working
 * directory, because no other count of its lines exists.
 */
export class WorkingDirectoryLinesChanged extends React.Component<
  IWorkingDirectoryLinesChangedProps,
  IWorkingDirectoryLinesChangedState
> {
  private lastRequest = 0
  private isUnmounted = false

  public constructor(props: IWorkingDirectoryLinesChangedProps) {
    super(props)
    this.state = { loadCount: 0, counts: null }
  }

  public componentDidMount() {
    this.loadCounts()
  }

  public componentDidUpdate(prevProps: IWorkingDirectoryLinesChangedProps) {
    if (prevProps.repository.id !== this.props.repository.id) {
      this.setState({ counts: null })
    }

    if (
      prevProps.repository.id !== this.props.repository.id ||
      prevProps.workingDirectory !== this.props.workingDirectory
    ) {
      this.loadCounts()
    }
  }

  public componentWillUnmount() {
    this.isUnmounted = true
  }

  public render() {
    const { counts, loadCount } = this.state

    if (counts === null || this.props.workingDirectory.files.length === 0) {
      return null
    }

    const groups = [counts.code, counts.tests, counts.json, counts.comments]

    return (
      <LinesChanged
        className="working-directory-lines-changed"
        linesAdded={groups.reduce((sum, c) => sum + c.added, 0)}
        linesDeleted={groups.reduce((sum, c) => sum + c.deleted, 0)}
        isExpanded={false}
        countsKey={`${loadCount}`}
        getCounts={this.getCounts}
      />
    )
  }

  private getCounts = async () => {
    const { counts } = this.state

    if (counts === null) {
      throw new Error('The counts did not load')
    }

    return counts
  }

  private async loadCounts() {
    const { repository, workingDirectory } = this.props
    const request = ++this.lastRequest

    if (workingDirectory.files.length === 0) {
      return
    }

    const untrackedPaths = workingDirectory.files
      .filter(f => f.status.kind === AppFileStatusKind.Untracked)
      .map(f => f.path)

    try {
      const counts = await getWorkingDirectoryCodeLineCounts(
        repository,
        untrackedPaths
      )

      if (!this.isUnmounted && request === this.lastRequest) {
        this.setState(state => ({ loadCount: state.loadCount + 1, counts }))
      }
    } catch (e) {
      log.error('Could not count the lines of the uncommitted changes', e)
    }
  }
}
