import * as React from 'react'
import { Disposable } from 'event-kit'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RadioButton } from '../lib/radio-button'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { Tooltip, TooltipDirection } from '../lib/tooltip'
import { createObservableRef } from '../lib/observable-ref'
import {
  DiffAlgorithm,
  diffAlgorithmShortcut,
  diffAlgorithmStore,
} from './diff-algorithm'

interface IDiffOptionsProps {
  readonly isInteractiveDiff: boolean
  readonly hideWhitespaceChanges: boolean
  readonly onHideWhitespaceChangesChanged: (
    hideWhitespaceChanges: boolean
  ) => void

  readonly showSideBySideDiff: boolean
  readonly onShowSideBySideDiffChanged: (showSideBySideDiff: boolean) => void

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void
}

interface IDiffOptionsState {
  readonly isPopoverOpen: boolean

  readonly diffAlgorithm: DiffAlgorithm
}

export class DiffOptions extends React.Component<
  IDiffOptionsProps,
  IDiffOptionsState
> {
  private innerButtonRef = createObservableRef<HTMLButtonElement>()
  private diffOptionsRef = React.createRef<HTMLDivElement>()
  private gearIconRef = React.createRef<HTMLSpanElement>()
  private diffAlgorithmSubscription: Disposable | null = null

  public constructor(props: IDiffOptionsProps) {
    super(props)
    this.state = {
      isPopoverOpen: false,
      diffAlgorithm: diffAlgorithmStore.value,
    }
  }

  // The store changes from the radio buttons and from the keyboard shortcut, so
  // the radio follows the store rather than its own clicks.
  public componentDidMount() {
    this.diffAlgorithmSubscription = diffAlgorithmStore.onDidChange(
      diffAlgorithm => this.setState({ diffAlgorithm })
    )
  }

  public componentWillUnmount() {
    this.diffAlgorithmSubscription?.dispose()
  }

  private onButtonClick = (event: React.FormEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (this.state.isPopoverOpen) {
      this.closePopover()
    } else {
      this.openPopover()
    }
  }

  private openPopover = () => {
    this.setState(prevState => {
      if (!prevState.isPopoverOpen) {
        this.props.onDiffOptionsOpened()
        return { isPopoverOpen: true }
      }
      return null
    })
  }

  private closePopover = () => {
    this.setState(prevState => {
      if (prevState.isPopoverOpen) {
        return { isPopoverOpen: false }
      }

      return null
    })
  }

  private onHideWhitespaceChangesChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    return this.props.onHideWhitespaceChangesChanged(
      event.currentTarget.checked
    )
  }

  public render() {
    const buttonLabel = `Diff ${__DARWIN__ ? 'Settings' : 'Options'}`
    return (
      <div className="diff-options-component" ref={this.diffOptionsRef}>
        <span className="diff-algorithm-label">
          {this.state.diffAlgorithm === DiffAlgorithm.Diffest
            ? 'Diffest'
            : 'Git'}
        </span>
        <button
          aria-label={buttonLabel}
          onClick={this.onButtonClick}
          aria-expanded={this.state.isPopoverOpen}
          ref={this.innerButtonRef}
        >
          <Tooltip
            target={this.innerButtonRef}
            direction={TooltipDirection.NORTH}
            applyAriaDescribedBy={false}
          >
            {buttonLabel}
          </Tooltip>
          <span ref={this.gearIconRef}>
            <Octicon symbol={octicons.gear} />
          </span>
          <Octicon symbol={octicons.triangleDown} />
        </button>
        {this.state.isPopoverOpen && this.renderPopover()}
      </div>
    )
  }

  private renderPopover() {
    const header = `Diff ${__DARWIN__ ? 'Settings' : 'Options'}`
    return (
      <Popover
        ariaLabelledby="diff-options-popover-header"
        anchor={this.gearIconRef.current}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        onMousedownOutside={this.closePopover}
        onClickOutside={this.closePopover}
      >
        <h3 id="diff-options-popover-header">{header}</h3>
        {this.renderHideWhitespaceChanges()}
        {this.renderShowSideBySide()}
        {this.renderDiffAlgorithm()}
      </Popover>
    )
  }

  private onUnifiedSelected = () => {
    this.props.onShowSideBySideDiffChanged(false)
  }
  private onSideBySideSelected = () => {
    this.props.onShowSideBySideDiffChanged(true)
  }

  private renderShowSideBySide() {
    return (
      <fieldset role="radiogroup">
        <legend>Diff display</legend>
        <RadioButton
          value="Unified"
          checked={!this.props.showSideBySideDiff}
          label="Unified"
          onSelected={this.onUnifiedSelected}
        />
        <RadioButton
          value="Split"
          checked={this.props.showSideBySideDiff}
          label={
            <>
              <div>Split</div>
            </>
          }
          onSelected={this.onSideBySideSelected}
        />
      </fieldset>
    )
  }

  private onGitAlgorithmSelected = () => {
    diffAlgorithmStore.set(DiffAlgorithm.Git)
  }
  private onDiffestAlgorithmSelected = () => {
    diffAlgorithmStore.set(DiffAlgorithm.Diffest)
  }

  private renderDiffAlgorithm() {
    const isDiffest = this.state.diffAlgorithm === DiffAlgorithm.Diffest

    return (
      <fieldset role="radiogroup">
        <legend>Diff algorithm</legend>
        <RadioButton
          value="Git"
          checked={!isDiffest}
          label="Git"
          onSelected={this.onGitAlgorithmSelected}
        />
        <RadioButton
          value="Diffest"
          checked={isDiffest}
          label="Diffest"
          onSelected={this.onDiffestAlgorithmSelected}
        />
        <p className="secondary-text">
          Press {diffAlgorithmShortcut} to switch between them.
        </p>
        {isDiffest && this.props.isInteractiveDiff && (
          <p className="secondary-text">
            While Diffest is on, you cannot select single lines or hunks to
            commit.
          </p>
        )}
      </fieldset>
    )
  }

  private renderHideWhitespaceChanges() {
    return (
      <fieldset>
        <legend>Whitespace</legend>
        <Checkbox
          value={
            this.props.hideWhitespaceChanges
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onHideWhitespaceChangesChanged}
          label={
            __DARWIN__ ? 'Hide Whitespace Changes' : 'Hide whitespace changes'
          }
        />
        {this.props.isInteractiveDiff && (
          <p className="secondary-text">
            Interacting with individual lines or hunks will be disabled while
            hiding whitespace.
          </p>
        )}
      </fieldset>
    )
  }
}
