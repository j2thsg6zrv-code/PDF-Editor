# Redline PDF Editor

A desktop PDF editor for construction and engineering drawings, modeled on the
workflows people use Bluebeam Revu for: markups, measurements and takeoffs, and
document tools. Built with Electron, [PDF.js](https://mozilla.github.io/pdf.js/)
and [pdf-lib](https://pdf-lib.js.org/). macOS first, Windows later.

## Roadmap

1. **Viewer** — open PDFs in tabs, zoom, pan, page thumbnails, text search. ✅
2. **Markups** — pen, highlighter, text, callouts, clouds, arrows, shapes, stamps; saved into the PDF. ✅
3. **Measurement and takeoff** — scale calibration, length, area, perimeter, count; Markups List with CSV/Excel export. ✅
4. **Document tools** — insert, extract, delete, rotate and reorder pages; compare and overlay revisions. ✅

## Installing on a Mac

Every change merged to `main` builds a Mac installer automatically (see the
[latest release](../../releases/latest)):

- Apple silicon Macs (M1 and newer): `Redline-PDF-Editor-arm64.dmg`
- Intel Macs: `Redline-PDF-Editor-x64.dmg`

Open the `.dmg` and drag **Redline PDF Editor** into **Applications**. The app isn't
signed with an Apple Developer ID yet, so the first time you open it macOS blocks it:
go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
After that it opens normally from Applications, Launchpad or the Dock.

## Running from source

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm start
```

To build the Mac installers yourself (`.dmg` files in `dist/`, on a Mac):

```sh
npm run dist:mac
```

## Using the viewer

| Action | Shortcut |
| --- | --- |
| Open PDF | ⌘O, or drag files onto the window |
| Close tab | ⌘W |
| Next / previous tab | ⌃Tab / ⌃⇧Tab |
| Find | ⌘F, then Enter / ⇧Enter for next / previous |
| Zoom in / out | ⌘= / ⌘−, or pinch, or ⌘-scroll |
| Actual size / fit page / fit width | ⌘0 / ⌘1 / ⌘2 |
| Pan | H for the pan tool, or hold Space and drag, or middle-drag |
| Select text | V |
| Toggle thumbnails | ⌘T |
| Save / Save As | ⌘S / ⇧⌘S |
| Undo / redo | ⌘Z / ⇧⌘Z |

## Markups

| Tool | Key | Notes |
| --- | --- | --- |
| Select | V | Click a markup to select it, drag to move, drag the handles to resize. Double-click a text box or callout to edit its text. |
| Pan | H | |
| Pen | P | Freehand |
| Highlighter | G | Freehand, translucent |
| Line / Arrow | L / A | Hold Shift to snap to 45° |
| Rectangle / Ellipse | R / E | Hold Shift for a square or circle |
| Cloud | C | Revision cloud |
| Text box | T | Click for a default-width box, or drag to set the width |
| Callout | Q | Drag from the point being called out to where the text goes |
| Stamp | S | Pick the stamp in the properties bar, then click to place |

## Measurement and takeoff

Set each sheet's scale first: pick a measurement tool, then choose a scale (architectural,
engineering or metric) from **Scale** in the properties bar, or choose **Calibrate from a
known dimension…** (or press X) and drag along a dimension you know, then type its real
length (`20`, `12.5` or `12'6"`). Tick **All pages** to apply it to the whole set.
Scales are saved in the PDF.

| Tool | Key | How |
| --- | --- | --- |
| Length | M | Drag between two points (Shift snaps to 45°) |
| Polylength | J | Click each point; double-click or Enter to finish |
| Area | B | Click each corner; double-click or Enter to finish |
| Perimeter | O | Click each corner; double-click or Enter to finish |
| Count | K | Click each item; change tools to start a new count |
| Calibrate | X | Drag along a known dimension |

While clicking out a shape, Backspace removes the last point and Esc cancels it.
Measurements update when the scale changes, and drag their handles to adjust points.

**Markups List** (⌘L, or the button in the status bar) lists every markup with its page,
type, text, measurement, color, author and date. Click a column to sort, filter by type,
page or text, click a row to jump to it, and **Export CSV…** to open the list in Excel.
Totals for each measurement type are shown at the bottom.

Delete or Backspace removes the selected markup; Esc deselects, then returns to Select.
The properties bar sets color, fill, line width, text size and opacity for the selected
markup, or for the next one you draw with the current tool.

Markups are saved into the PDF as standard annotations (ink, line, square, circle,
free text, stamp) with their own appearance, so they show up in Preview, Acrobat,
Bluebeam and other readers. When you reopen the file here they come back editable.

## Pages

The buttons above the thumbnails (and the **Pages** menu) work on the selected
thumbnails, or on the page in view when none are selected. Click a thumbnail to go to
it, ⌘-click to pick several, Shift-click to pick a range.

| Action | How |
| --- | --- |
| Rotate | ↺ / ↻, or ⌘R and ⇧⌘R |
| Reorder | Drag thumbnails to a new position |
| Insert pages | **＋** picks a PDF and inserts it after the page in view, or drag a PDF from Finder onto the thumbnails |
| Extract pages | **⇪** saves the chosen pages, with their markups, as a new PDF |
| Delete pages | **🗑** (asks first) |

Markups and scales move with their pages. Page changes aren't written to disk until you
save, and they clear the undo history.

## Compare revisions

**Pages → Compare Documents…** compares two open PDFs page by page (or use **Open
Another PDF…** in the dialog). **Overlay** shows the old version in red and the new one in
blue, with unchanged linework in black. **Differences** boxes each changed area on the new
version, and **Cloud changes in new version** adds a revision cloud around every change as
a markup, ready to review and save.
