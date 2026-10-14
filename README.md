# Linkly

A personal link hub: one fast, single page for the websites, platforms, and files you use most.

No build step and no server. Open `index.html` in a browser, or host the folder on any static host (GitHub Pages, Netlify, and so on).

## Features

- **Category sections** (Work, Learning, Tools, Social, Finance, plus any you add) with collapsible headers and up/down reordering.
- **Nested folders**: categories can hold folders, and folders can hold sub-folders, as deep as you like (for example Learning › Stocks › US Stocks › Dividends). Each folder shows its own links first, then its sub-folders. A folder's count includes everything inside it, and each folder can be collapsed and reordered among its siblings. To create a folder, use the folder **+** button on any category or folder header, or pick **＋ New folder here…** in a category menu. Deleting a folder moves its links and sub-folders up one level, so nothing is lost.
- **Folder sidebar** (wide screens): a tree of every category and folder, with link counts. Click any item to jump there; collapsed sections open automatically.
- **Copy link**: the copy button on each card puts its URL on the clipboard.
- **Cards** with a favicon, title, note, tags, and an optional attached file (PDF, image, doc, and so on). A card can be a file with no URL.
- **Instant search** across title, note, tags, category, domain, and file name. Press `/` to focus it, `Enter` to open the first result, and `Esc` to clear it.
- **Pinned** row for daily links, and a **Recently opened** row.
- **Tag filter**: click tags in the tag bar or on a card. Several tags combine with AND.
- **Quick add**: paste a URL, then pick a category or folder (for example `Learning › Stocks › US Stocks`) and tags. The title and favicon fill in automatically. Use **More…** for the full form, including notes and attachments.
- **Edit, delete (with undo), and drag-and-drop**, including moving links between categories. You can drop a card on a category or folder header to move it there, even when that section is collapsed. Dragging works with mouse and touch. With the drag handle focused, the arrow keys also reorder.
- **Export/Import JSON** from the ⋮ menu. Exports include attachments. Imports can be merged with your current data or replace it.
- Light and dark mode (follows the system setting until you toggle it), and a responsive layout.

## Data and privacy

- Links are stored in `localStorage` and attachments in IndexedDB. Both stay in this browser, so export a backup now and then.
- Favicons come from Google's favicon service (`google.com/s2/favicons`).
- The title is guessed from the URL at first. Linkly then tries to fetch the page's real title directly, which only works for sites that allow it. If that fails, it falls back to [microlink.io](https://microlink.io). The free tier allows about 50 lookups per day. To keep every lookup in the browser, set `META_SERVICE = ''` at the top of `app.js`.

## Files

- `index.html`: markup and dialogs
- `styles.css`: theme tokens, layout, and dark mode
- `app.js`: state, rendering, search, drag-and-drop, and import/export
