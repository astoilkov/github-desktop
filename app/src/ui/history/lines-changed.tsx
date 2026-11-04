import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Repository } from '../../models/repository'
import { IChangesetData } from '../../lib/git'
import {
  getCodeLineCounts,
  ICodeLineCounts,
  ILineCounts,
} from '../../lib/git/code-lines'
import { Tooltip, TooltipDirection } from '../lib/tooltip'
import { createObservableRef } from '../lib/observable-ref'

interface ILinesChangedProps {
  readonly repository: Repository
  readonly changesetData: IChangesetData
  readonly isExpanded: boolean
}

interface ILinesChangedState {
  /** The diff range that `counts` is for, as `parent..commit`. */
  readonly range: string | null
  readonly counts: ICodeLineCounts | null
}

/**
 * The code, test, and comment counts load on hover, not with the changeset,
 * because they need the full diff of every file.
 */
export class LinesChanged extends React.Component<
  ILinesChangedProps,
  ILinesChangedState
> {
  private readonly wrapperRef = createObservableRef<HTMLDivElement>()
  private loadingRange: string | null = null

  public constructor(props: ILinesChangedProps) {
    super(props)
    this.state = { range: null, counts: null }
  }

  public render() {
    const { changesetData, isExpanded } = this.props
    const { linesAdded, linesDeleted } = changesetData

    if (linesAdded === 0 && linesDeleted === 0) {
      return null
    }

    return (
      <div
        className="ecs-meta-item lines-added-deleted"
        ref={this.wrapperRef}
        onMouseEnter={this.onMouseEnter}
      >
        <Tooltip
          target={this.wrapperRef}
          direction={TooltipDirection.SOUTH}
          className="lines-changed-tooltip"
        >
          {this.renderTooltip()}
        </Tooltip>
        {isExpanded ? <Octicon symbol={octicons.diff} /> : null}
        <div className="lines-added">
          {!isExpanded ? <>+{linesAdded}</> : <>{linesAdded} added lines</>}
        </div>
        <div className="lines-deleted">
          {!isExpanded ? (
            <>-{linesDeleted}</>
          ) : (
            <>{linesDeleted} removed lines</>
          )}
        </div>
      </div>
    )
  }

  private renderTooltip() {
    const range = getRange(this.props.changesetData)
    const { counts } = this.state

    if (counts === null || this.state.range !== range) {
      return <>Counting code, test, and comment lines…</>
    }

    return (
      <div className="lines-changed-table">
        <LineCountsRow label="Code" counts={counts.code} />
        <LineCountsRow label="Tests" counts={counts.tests} />
        <LineCountsRow label="Comments" counts={counts.comments} />
      </div>
    )
  }

  private onMouseEnter = async () => {
    const { repository, changesetData } = this.props
    const range = getRange(changesetData)
    const file = changesetData.files.at(0)

    if (
      file === undefined ||
      range === this.state.range ||
      range === this.loadingRange
    ) {
      return
    }

    this.loadingRange = range

    try {
      const counts = await getCodeLineCounts(
        repository,
        file.parentCommitish,
        file.commitish
      )

      if (range === getRange(this.props.changesetData)) {
        this.setState({ range, counts })
      }
    } catch (e) {
      log.error('Could not count the code, test, and comment lines', e)
    } finally {
      if (this.loadingRange === range) {
        this.loadingRange = null
      }
    }
  }
}

interface ILineCountsRowProps {
  readonly label: string
  readonly counts: ILineCounts
}

function LineCountsRow({ label, counts }: ILineCountsRowProps) {
  return (
    <>
      <span className="label">{label}</span>
      <span className="lines-added">+{counts.added}</span>
      <span className="lines-deleted">-{counts.deleted}</span>
    </>
  )
}

/** All the files of a changeset share the same range. */
function getRange(changesetData: IChangesetData): string | null {
  const file = changesetData.files.at(0)
  return file === undefined
    ? null
    : `${file.parentCommitish}..${file.commitish}`
}
