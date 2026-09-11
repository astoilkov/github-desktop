let nextContainerId = 0

/**
 * Lights both ends of a move at full opacity while the pointer is on either
 * one. The end the line left is otherwise dimmed.
 *
 * The two ends sit in different rows, and the list is virtualized: rows are
 * made and thrown away as it scrolls, so a class set on the spans would go
 * with them. A style rule for the hovered move also applies to rows rendered
 * after it was written.
 *
 * Returns a function that stops watching.
 */
export function watchMoveHover(container: HTMLElement): () => void {
  const id = String(nextContainerId++)
  const style = document.createElement('style')
  let litMove: string | null = null

  container.dataset.diffestId = id
  document.head.appendChild(style)

  const light = (move: string | null) => {
    if (move === litMove) {
      return
    }

    litMove = move
    // The class is written twice to outrank the rule that dims the old end.
    style.textContent =
      move === null
        ? ''
        : `[data-diffest-id="${id}"] .cm-${move}.cm-${move} { opacity: 1; }`
  }

  const onMouseOver = (event: MouseEvent) => {
    const end =
      event.target instanceof Element
        ? event.target.closest('[class*="cm-df-m-"]')
        : null

    light(end === null ? null : getMove(end))
  }

  const onMouseLeave = () => light(null)

  container.addEventListener('mouseover', onMouseOver)
  container.addEventListener('mouseleave', onMouseLeave)

  return () => {
    container.removeEventListener('mouseover', onMouseOver)
    container.removeEventListener('mouseleave', onMouseLeave)
    style.remove()
  }
}

/** The `df-m-<n>` class of a span that is an end of a move. */
function getMove(element: Element): string | null {
  const match = /(?:^|\s)cm-(df-m-\d+)(?=\s|$)/.exec(element.className)
  return match === null ? null : match[1]
}
