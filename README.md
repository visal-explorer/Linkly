# Linkly

A personal link hub: one fast, single page for the websites, platforms, and files you use most.

No build step and no server. Open `index.html` in a browser, or host the folder on any static host (GitHub Pages, Netlify, and so on).

## Features

- **Category sections** (Work, Learning, Tools, Social, Finance, plus any you add) with collapsible headers and up/down reordering.
- **Groups inside categories**: split a category into sub-sections, for example Learning › Stocks, Trading, Technology. Each group has its own collapsible header, link count, and up/down order. To create one, use the folder button on a category header, or pick **＋ New group…** in a category menu. Links without a group appear first in a category. Deleting a group keeps its links in that category, without a group.
- **Cards** with a favicon, title, note, tags, and an optional attached file (PDF, image, doc, and so on). A card can be a file with no URL.
- **Instant search** across title, note, tags, category, domain, and file name. Press `/` to focus it, `Enter` to open the first result, and `Esc` to clear it.
- **Pinned** row for daily links, and a **Recently opened** row.
- **Tag filter**: click tags in the tag bar or on a card. Several tags combine with AND.
- **Quick add**: paste a URL, then pick a category or group (for example `Learning › Stocks`) and tags. The title and favicon fill in automatically. Use **More…** for the full form, including notes and attachments.
- **Edit, delete (with undo), and drag-and-drop**, including moving links between categories. You can drop a card on a category or group header to move it there, even when that section is collapsed. Dragging works with mouse and touch. With the drag handle focused, the arrow keys also reorder.
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
