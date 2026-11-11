import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ICodeLineCounts, ILineCounts } from '../../lib/git/code-lines'
import { Tooltip, TooltipDirection } from '../lib/tooltip'
import { createObservableRef } from '../lib/observable-ref'

interface ILinesChangedProps {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly isExpanded: boolean
  readonly className: string

  /** Changes when the lines change, so that the counts load again. */
  readonly countsKey: string | null
  readonly getCounts: () => Promise<ICodeLineCounts>
}

interface ILinesChangedState {
  /** The `countsKey` that `counts` is for. */
  readonly key: string | null
  readonly counts: ICodeLineCounts | null
}

/**
 * The counts in the tooltip load on hover, because they can need the full diff
 * of every file.
 */
export class LinesChanged extends React.Component<
  ILinesChangedProps,
  ILinesChangedState
> {
  private readonly wrapperRef = createObservableRef<HTMLDivElement>()
  private loadingKey: string | null = null

  public constructor(props: ILinesChangedProps) {
    super(props)
    this.state = { key: null, counts: null }
  }

  public render() {
    const { linesAdded, linesDeleted, isExpanded, className } = this.props

    if (linesAdded === 0 && linesDeleted === 0) {
      return null
    }

    return (
      <div
        className={`${className} lines-added-deleted`}
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
    const { counts, key } = this.state

    if (counts === null || key !== this.props.countsKey) {
      return <>Counting the lines…</>
    }

    return (
      <div className="lines-changed-table">
        <LineCountsRow label="Code" counts={counts.code} />
        <LineCountsRow label="Imports" counts={counts.imports} />
        <LineCountsRow label="Tests" counts={counts.tests} />
        <LineCountsRow label="JSON" counts={counts.json} />
        <LineCountsRow label="Comments" counts={counts.comments} />
      </div>
    )
  }

  private onMouseEnter = async () => {
    const { countsKey: key, getCounts } = this.props

    if (key === null || key === this.state.key || key === this.loadingKey) {
      return
    }

    this.loadingKey = key

    try {
      const counts = await getCounts()

      if (key === this.props.countsKey) {
        this.setState({ key, counts })
      }
    } catch (e) {
      log.error('Could not count the lines of each group', e)
    } finally {
      if (this.loadingKey === key) {
        this.loadingKey = null
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
