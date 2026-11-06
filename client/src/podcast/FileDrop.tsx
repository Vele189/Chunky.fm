import { type DragEvent, type ReactNode, useCallback, useRef, useState } from 'react'

/**
 * A file, chosen by dropping one on it or by pressing it.
 *
 * The console's two files are a video that may be a gigabyte and the thumbnail
 * that goes with it, and both arrive the same way: somebody has an export open
 * in a finder window beside the browser. A `<input type="file">` makes them
 * click through a system dialog to a folder they are already looking at, which
 * is the long way round to the file under the cursor.
 *
 * So this is the station's own idiom rather than a new one — the library takes
 * MP3s the same way, and `.dropzone` in styles.css is where that started. Two
 * differences, and both are about what this is for:
 *
 *  - **It holds one file, not a pile.** The library is a queue and takes
 *    everything dropped on it; an episode has exactly one video and exactly one
 *    thumbnail, so a second file dropped here *replaces* the first rather than
 *    joining it. Dropping several is a mistake with an obvious reading: the
 *    first one is taken and the rest are ignored.
 *  - **The input stays.** It is hidden, not removed, and the drop writes into
 *    it — which is what keeps the form a form: the file leaves in the same
 *    `FormData` it always did, `required` still refuses an empty one, and
 *    nothing here has to know what happens to it afterwards.
 *
 * The whole thing is a `<label>`, so pressing it opens the picker with no
 * JavaScript at all and the keyboard reaches it the way it reaches any field.
 */

export interface FileDropProps {
  /** The form field's name. What the server reads it as. */
  name: string
  /** What this file is, said plainly. Doubles as the field's label. */
  label: ReactNode
  /** The `accept` list, in the same shape an input takes. */
  accept: string
  required?: boolean
  /** What to say under it before a file is chosen. */
  hint?: ReactNode
  /** Called with whatever was chosen, however it was chosen. */
  onFile?: (file: File | undefined) => void
  /** A line about the file that was chosen: its size, or what is wrong with it. */
  note?: ReactNode
}

export function FileDrop({ name, label, accept, required, hint, onFile, note }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [chosen, setChosen] = useState<File | null>(null)

  const take = useCallback(
    (file: File | undefined) => {
      setChosen(file ?? null)
      onFile?.(file)
    },
    [onFile],
  )

  /*
   * Writing the dropped file into the input.
   *
   * `input.files` is settable from a `DataTransfer`, which is the whole trick
   * and the reason this can be a drop target without becoming a second way of
   * submitting a form. Everything downstream — `FormData`, `required`, the
   * change event — behaves exactly as it would have if the file had been picked
   * from the dialog.
   */
  const drop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      setOver(false)
      const file = event.dataTransfer.files.item(0)
      if (!file || !input.current) return
      const carrier = new DataTransfer()
      carrier.items.add(file)
      input.current.files = carrier.files
      take(file)
    },
    [take],
  )

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the label is
    // the control here; the drag handlers are an addition to it rather than a
    // replacement for the input inside it.
    <label
      className="drop"
      data-over={over ? 'true' : 'false'}
      data-chosen={chosen ? 'true' : 'false'}
      onDragOver={(event) => {
        // Both are needed: without the first the browser navigates to the file,
        // and without the second the drop is refused with no explanation.
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <span className="drop__label">{label}</span>

      <span className="drop__body">
        <span className="drop__mark" aria-hidden="true">
          <ArrowIntoTray />
        </span>
        <span className="drop__said">
          {chosen ? (
            <>
              <span className="drop__name">{chosen.name}</span>
              <span className="drop__hint">{note ?? 'Drop another to replace it'}</span>
            </>
          ) : (
            <>
              <span className="drop__name">Drop it here</span>
              <span className="drop__hint">{hint ?? 'or press to choose a file'}</span>
            </>
          )}
        </span>
      </span>

      <input
        ref={input}
        className="drop__input"
        name={name}
        type="file"
        accept={accept}
        required={required}
        onChange={(event) => take(event.target.files?.[0])}
      />
    </label>
  )
}

/** A tray with an arrow going into it. The station's own upload mark. */
function ArrowIntoTray() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3v11m0 0l-4-4m4 4l4-4M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
