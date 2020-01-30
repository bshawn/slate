// #region imports

import React, {
  useEffect,
  useRef,
  useMemo,
  useCallback,
  SyntheticEvent,
} from 'react'
import { Editor, Element, NodeEntry, Node, Range, Transforms } from 'slate'
import debounce from 'debounce'
import scrollIntoView from 'scroll-into-view-if-needed'

import Children from '../children'
import Hotkeys from '../../utils/hotkeys'
import { IS_FIREFOX, IS_SAFARI } from '../../utils/environment'
import { ReactEditor } from '../..'
import { ReadOnlyContext } from '../../hooks/use-read-only'
import { useSlate } from '../../hooks/use-slate'
import { useIsomorphicLayoutEffect } from '../../hooks/use-isomorphic-layout-effect'
import {
  DOMElement,
  isDOMElement,
  isDOMNode,
  DOMStaticRange,
} from '../../utils/dom'
import {
  EDITOR_TO_ELEMENT,
  ELEMENT_TO_NODE,
  IS_READ_ONLY,
  NODE_TO_ELEMENT,
  IS_FOCUSED,
  PLACEHOLDER_SYMBOL,
} from '../../utils/weak-maps'

import {
  defaultDecorate,
  hasEditableTarget,
  hasTarget,
  isDOMEventHandled,
  isEventHandled,
  isRangeEqual,
  setFragmentData,
} from './utils'

import { RenderElementProps } from './RenderElementProps'
import { RenderLeafProps } from './RenderLeafProps'

// #endregion

/**
 * `EditableProps` are passed to the `<Editable>` component.
 */

export type EditableProps = {
  decorate?: (entry: NodeEntry) => Range[]
  onDOMBeforeInput?: (event: Event) => void
  placeholder?: string
  readOnly?: boolean
  role?: string
  style?: React.CSSProperties
  renderElement?: (props: RenderElementProps) => JSX.Element
  renderLeaf?: (props: RenderLeafProps) => JSX.Element
  as?: React.ElementType
} & React.TextareaHTMLAttributes<HTMLDivElement>

/**
 * Editable.
 */

export const Editable = (props: EditableProps) => {
  const {
    autoFocus,
    decorate = defaultDecorate,
    onDOMBeforeInput: propsOnDOMBeforeInput,
    placeholder,
    readOnly = false,
    renderElement,
    renderLeaf,
    style = {},
    as: Component = 'div',
    ...attributes
  } = props
  const editor = useSlate()
  const ref = useRef<HTMLDivElement>(null)

  // Update internal state on each render.
  IS_READ_ONLY.set(editor, readOnly)

  // Keep track of some state for the event handler logic.
  const state = useMemo(
    () => ({
      isComposing: false,
      isUpdatingSelection: false,
      latestElement: null as DOMElement | null,
    }),
    []
  )

  // Update element-related weak maps with the DOM element ref.
  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      EDITOR_TO_ELEMENT.set(editor, ref.current)
      NODE_TO_ELEMENT.set(editor, ref.current)
      ELEMENT_TO_NODE.set(ref.current, editor)
    } else {
      NODE_TO_ELEMENT.delete(editor)
    }
  })

  // Attach a native DOM event handler for `selectionchange`, because React's
  // built-in `onSelect` handler doesn't fire for all selection changes. It's a
  // leaky polyfill that only fires on keypresses or clicks. Instead, we want to
  // fire for any change to the selection inside the editor. (2019/11/04)
  // https://github.com/facebook/react/issues/5785
  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('selectionchange', onDOMSelectionChange)
    return () => {
      window.document.removeEventListener(
        'selectionchange',
        onDOMSelectionChange
      )
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('beforeinput', onDomBeforeInput)
    return () => {
      window.document.removeEventListener('beforeinput', onDomBeforeInput)
    }
  }, [])

  const onDomBeforeInput = useCallback(event => {
    console.log('onDomBeforeInput')
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('input', onDomInput)
    return () => {
      window.document.removeEventListener('input', onDomInput)
    }
  }, [])

  const onDomInput = useCallback(event => {
    console.log('onDomInput')
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('textinput', onDomTextInput)
    return () => {
      window.document.removeEventListener('textinput', onDomTextInput)
    }
  }, [])

  const onDomTextInput = useCallback(event => {
    console.log('onDomTextInput')
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('keydown', onDomKeyDown)
    return () => {
      window.document.removeEventListener('keydown', onDomKeyDown)
    }
  }, [])

  const onDomKeyDown = useCallback(event => {
    console.log('onDomKeyDown')
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useIsomorphicLayoutEffect(() => {
    window.document.addEventListener('keyup', onDomKeyUp)
    return () => {
      window.document.removeEventListener('keyup', onDomKeyUp)
    }
  }, [])

  const onDomKeyUp = useCallback(event => {
    console.log('onDomKeyUp')
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Whenever the editor updates, make sure the DOM selection state is in sync.
  useIsomorphicLayoutEffect(() => {
    const { selection } = editor
    const domSelection = window.getSelection()

    if (state.isComposing || !domSelection || !ReactEditor.isFocused(editor)) {
      return
    }

    const hasDomSelection = domSelection.type !== 'None'

    // If the DOM selection is properly unset, we're done.
    if (!selection && !hasDomSelection) {
      return
    }

    const newDomRange = selection && ReactEditor.toDOMRange(editor, selection)

    // If the DOM selection is already correct, we're done.
    if (
      hasDomSelection &&
      newDomRange &&
      isRangeEqual(domSelection.getRangeAt(0), newDomRange)
    ) {
      return
    }

    // Otherwise the DOM selection is out of sync, so update it.
    const el = ReactEditor.toDOMNode(editor, editor)
    state.isUpdatingSelection = true
    domSelection.removeAllRanges()

    if (newDomRange) {
      domSelection.addRange(newDomRange!)
      const leafEl = newDomRange.startContainer.parentElement!
      scrollIntoView(leafEl, { scrollMode: 'if-needed' })
    }

    setTimeout(() => {
      // COMPAT: In Firefox, it's not enough to create a range, you also need
      // to focus the contenteditable element too. (2016/11/16)
      if (newDomRange && IS_FIREFOX) {
        el.focus()
      }

      state.isUpdatingSelection = false
    })
  })

  // The autoFocus TextareaHTMLAttribute doesn't do anything on a div, so it
  // needs to be manually focused.
  useEffect(() => {
    if (ref.current && autoFocus) {
      ref.current.focus()
    }
    if (ref.current && !ref.current.onkeydown) {
      ref.current.onkeydown = e => {
        console.log('onRefKeyDown')
        e.preventDefault()
        e.stopPropagation()
      }
    }
    if (ref.current && !ref.current.onkeyup) {
      ref.current.onkeyup = e => {
        console.log('onRefKeyUp')
        e.preventDefault()
        e.stopPropagation()
      }
    }
    if (ref.current && !ref.current.oninput) {
      ref.current.oninput = e => {
        console.log('onRefInput')
        e.preventDefault()
        e.stopPropagation()
      }
    }
    if (ref.current && !(ref.current as any).onbeforeinput) {
      ; (ref.current as any).onbeforeinput = (e: Event) => {
        console.log('onRefBeforeInput')
        e.preventDefault()
        e.stopPropagation()
      }
    }
    if (ref.current) {
      ref.current.addEventListener('compositionstart', e => {
        console.log('onRefCompositionStart')
        e.preventDefault()
        e.stopPropagation()
      })
    }
    if (ref.current) {
      ref.current.addEventListener('compositionupdate', e => {
        console.log('onRefCompositionUpdate', e)
        e.cancelBubble = true
        e.preventDefault()
        e.stopPropagation()
      })
    }
    if (ref.current) {
      ref.current.addEventListener('compositionend', e => {
        console.log('onRefCompositionEnd')
        e.preventDefault()
        e.stopPropagation()
      })
    }
  }, [autoFocus])

  // Listen on the native `selectionchange` event to be able to update any time
  // the selection changes. This is required because React's `onSelect` is leaky
  // and non-standard so it doesn't fire until after a selection has been
  // released. This causes issues in situations where another change happens
  // while a selection is being dragged.
  const onDOMSelectionChange = useCallback(
    debounce(() => {
      if (!readOnly && !state.isComposing && !state.isUpdatingSelection) {
        const { activeElement } = window.document
        const el = ReactEditor.toDOMNode(editor, editor)
        const domSelection = window.getSelection()
        const domRange =
          domSelection &&
          domSelection.rangeCount > 0 &&
          domSelection.getRangeAt(0)

        if (activeElement === el) {
          state.latestElement = activeElement
          IS_FOCUSED.set(editor, true)
        } else {
          IS_FOCUSED.delete(editor)
        }

        if (
          domRange &&
          hasEditableTarget(editor, domRange.startContainer) &&
          hasEditableTarget(editor, domRange.endContainer)
        ) {
          const range = ReactEditor.toSlateRange(editor, domRange)
          Transforms.select(editor, range)
        } else {
          Transforms.deselect(editor)
        }
      }
    }, 100),
    []
  )

  const decorations = decorate([editor, []])

  if (
    placeholder &&
    editor.children.length === 1 &&
    Array.from(Node.texts(editor)).length === 1 &&
    Node.string(editor) === ''
  ) {
    const start = Editor.start(editor, [])
    decorations.push({
      [PLACEHOLDER_SYMBOL]: true,
      placeholder,
      anchor: start,
      focus: start,
    })
  }

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <Component
        // COMPAT: The Grammarly Chrome extension works by changing the DOM
        // out from under `contenteditable` elements, which leads to weird
        // behaviors so we have to disable it like editor. (2017/04/24)
        data-gramm={false}
        role={readOnly ? undefined : 'textbox'}
        {...attributes}
        // COMPAT: Firefox doesn't support the `beforeinput` event, so we'd
        // have to use hacks to make these replacement-based features work.
        spellCheck={IS_FIREFOX ? undefined : attributes.spellCheck}
        autoCorrect={IS_FIREFOX ? undefined : attributes.autoCorrect}
        autoCapitalize={IS_FIREFOX ? undefined : attributes.autoCapitalize}
        data-slate-editor
        data-slate-node="value"
        contentEditable={readOnly ? undefined : true}
        suppressContentEditableWarning
        ref={ref}
        style={{
          // Prevent the default outline styles.
          outline: 'none',
          // Preserve adjacent whitespace and new lines.
          whiteSpace: 'pre-wrap',
          // Allow words to break if they are too long.
          wordWrap: 'break-word',
          // Allow for passed-in styles to override anything.
          ...style,
        }}
        onKeyDown={useCallback((event: React.KeyboardEvent) => {
          console.log('onKeyDown')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onKeyUp={useCallback((event: React.KeyboardEvent) => {
          console.log('onKeyUp')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onCompositionStart={useCallback((event: React.SyntheticEvent) => {
          console.log('onCompositionStart')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onCompositionUpdate={useCallback((event: React.SyntheticEvent) => {
          console.log('onCompositionUpdate')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onBeforeInput={useCallback((event: React.SyntheticEvent) => {
          console.log('onBeforeInput')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onInput={useCallback((event: React.SyntheticEvent) => {
          console.log('onInput')
          event.preventDefault()
          event.stopPropagation()
        }, [])}
        onSelect={useCallback((event: React.SyntheticEvent) => {
          console.log('onselect-synthetic', event)
        }, [])}
        onBlur={useCallback(
          (event: React.FocusEvent<HTMLDivElement>) => {
            if (
              readOnly ||
              state.isUpdatingSelection ||
              !hasEditableTarget(editor, event.target) ||
              isEventHandled(event, attributes.onBlur)
            ) {
              return
            }

            // COMPAT: If the current `activeElement` is still the previous
            // one, this is due to the window being blurred when the tab
            // itself becomes unfocused, so we want to abort early to allow to
            // editor to stay focused when the tab becomes focused again.
            if (state.latestElement === window.document.activeElement) {
              return
            }

            const { relatedTarget } = event
            const el = ReactEditor.toDOMNode(editor, editor)

            // COMPAT: The event should be ignored if the focus is returning
            // to the editor from an embedded editable element (eg. an <input>
            // element inside a void node).
            if (relatedTarget === el) {
              return
            }

            // COMPAT: The event should be ignored if the focus is moving from
            // the editor to inside a void node's spacer element.
            if (
              isDOMElement(relatedTarget) &&
              relatedTarget.hasAttribute('data-slate-spacer')
            ) {
              return
            }

            // COMPAT: The event should be ignored if the focus is moving to a
            // non- editable section of an element that isn't a void node (eg.
            // a list item of the check list example).
            if (
              relatedTarget != null &&
              isDOMNode(relatedTarget) &&
              ReactEditor.hasDOMNode(editor, relatedTarget)
            ) {
              const node = ReactEditor.toSlateNode(editor, relatedTarget)

              if (Element.isElement(node) && !editor.isVoid(node)) {
                return
              }
            }

            IS_FOCUSED.delete(editor)
          },
          [readOnly, attributes.onBlur]
        )}
        onClick={useCallback(
          (event: React.MouseEvent<HTMLDivElement>) => {
            if (
              !readOnly &&
              hasTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onClick) &&
              isDOMNode(event.target)
            ) {
              const node = ReactEditor.toSlateNode(editor, event.target)
              const path = ReactEditor.findPath(editor, node)
              const start = Editor.start(editor, path)

              if (Editor.void(editor, { at: start })) {
                const range = Editor.range(editor, start)
                Transforms.select(editor, range)
              }
            }
          },
          [readOnly, attributes.onClick]
        )}
        onCopy={useCallback(
          (event: React.ClipboardEvent<HTMLDivElement>) => {
            if (
              hasEditableTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onCopy)
            ) {
              event.preventDefault()
              setFragmentData(event.clipboardData, editor)
            }
          },
          [attributes.onCopy]
        )}
        onCut={useCallback(
          (event: React.ClipboardEvent<HTMLDivElement>) => {
            if (
              !readOnly &&
              hasEditableTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onCut)
            ) {
              event.preventDefault()
              setFragmentData(event.clipboardData, editor)
              const { selection } = editor

              if (selection && Range.isExpanded(selection)) {
                Editor.deleteFragment(editor)
              }
            }
          },
          [readOnly, attributes.onCut]
        )}
        onDragOver={useCallback(
          (event: React.DragEvent<HTMLDivElement>) => {
            if (
              hasTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onDragOver)
            ) {
              // Only when the target is void, call `preventDefault` to signal
              // that drops are allowed. Editable content is droppable by
              // default, and calling `preventDefault` hides the cursor.
              const node = ReactEditor.toSlateNode(editor, event.target)

              if (Editor.isVoid(editor, node)) {
                event.preventDefault()
              }
            }
          },
          [attributes.onDragOver]
        )}
        onDragStart={useCallback(
          (event: React.DragEvent<HTMLDivElement>) => {
            if (
              hasTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onDragStart)
            ) {
              const node = ReactEditor.toSlateNode(editor, event.target)
              const path = ReactEditor.findPath(editor, node)
              const voidMatch = Editor.void(editor, { at: path })

              // If starting a drag on a void node, make sure it is selected
              // so that it shows up in the selection's fragment.
              if (voidMatch) {
                const range = Editor.range(editor, path)
                Transforms.select(editor, range)
              }

              setFragmentData(event.dataTransfer, editor)
            }
          },
          [attributes.onDragStart]
        )}
        onFocus={useCallback(
          (event: React.FocusEvent<HTMLDivElement>) => {
            if (
              !readOnly &&
              !state.isUpdatingSelection &&
              hasEditableTarget(editor, event.target) &&
              !isEventHandled(event, attributes.onFocus)
            ) {
              const el = ReactEditor.toDOMNode(editor, editor)
              state.latestElement = window.document.activeElement

              // COMPAT: If the editor has nested editable elements, the focus
              // can go to them. In Firefox, this must be prevented because it
              // results in issues with keyboard navigation. (2017/03/30)
              if (IS_FIREFOX && event.target !== el) {
                el.focus()
                return
              }

              IS_FOCUSED.set(editor, true)
            }
          },
          [readOnly, attributes.onFocus]
        )}
      >
        <Children
          decorate={decorate}
          decorations={decorations}
          node={editor}
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          selection={editor.selection}
        />
      </Component>
    </ReadOnlyContext.Provider>
  )
}
