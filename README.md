# PDF Editor

A desktop PDF editor for construction and engineering drawings, modeled on the
workflows people use Bluebeam Revu for: markups, measurements and takeoffs, and
document tools. Built with Electron, [PDF.js](https://mozilla.github.io/pdf.js/)
and [pdf-lib](https://pdf-lib.js.org/). macOS first, Windows later.

## Roadmap

1. **Viewer** — open PDFs in tabs, zoom, pan, page thumbnails, text search. ✅
2. **Markups** — pen, highlighter, text, callouts, clouds, arrows, shapes, stamps; saved into the PDF.
3. **Measurement and takeoff** — scale calibration, length, area, perimeter, count; Markups List with CSV/Excel export.
4. **Document tools** — merge, split, insert, rotate, reorder pages; compare and overlay revisions.

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm start
```

To build a Mac installer (`.dmg` in `dist/`):

```sh
npm run dist:mac
```

The app is not code-signed yet, so the first time you open a built copy, right-click
it in Finder and choose **Open**.

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
