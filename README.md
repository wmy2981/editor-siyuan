# Editor

Open and edit the text files a note links to, in a SiYuan tab of their own. The editor uses your SiYuan code font and your chosen syntax colours.


## What it does

SiYuan renders a link to a file in `assets/` as an ordinary hyperlink. Clicking it hands the file to the system default application — a text editor, or nothing at all. This plugin opens it in SiYuan instead, in a custom tab with syntax highlighting, line numbers, search and undo.

Three ways in:

- Click a link to an asset text file, if takeover is on (the default).
- Right-click the link and pick the plugin submenu entry, **Open with Editor**.
- Turn takeover off and use only the menu entry.

Only files in the workspace's `assets/` folder are handled. Links to absolute paths outside the workspace (`file:///...`) are left alone.

## Requirements

- SiYuan 3.8.3 or later.
- Desktop only. SiYuan's plugin API for custom tabs is a no-op on mobile, and the settings here are declared for Windows, macOS and Linux.
- The administrator role. Locating and writing an asset uses `/api/asset/resolveAssetPath`, `/api/asset/statAsset` and `/api/file/putFile`, which SiYuan restricts to administrators. A single-user local workspace is always an administrator.

## Install

From the marketplace: **Settings - Marketplace - Downloaded - Plugins**, search for Editor.

Manually: unzip `package.zip` into `<workspace>/data/plugins/editor-siyuan/` and enable it.

## Saving

Nothing is written until you ask for it. Save with the button in the code block's top-right corner or with `Ctrl+S` (`Cmd+S`). The button stays visible whenever there are unsaved changes.

The file is written back as UTF-8, keeping its original byte order mark and line-ending style, so opening and saving a CRLF file does not rewrite every line.

The save shortcut is registered as a plugin command. Change it under **Settings - Keymap - Plugins**.

## Settings

**Settings - Marketplace - Downloaded - Plugins - Editor - Settings**.

| Setting | Default | Meaning |
| --- | --- | --- |
| Open asset text files in a tab | on | Whether a click on a whitelisted link opens this editor instead of the system default application |
| Gesture to take over | Click | Which click is taken over. Every other gesture keeps SiYuan's own behaviour, so Alt or Shift click still opens the system default application and Ctrl click still reveals the file |
| File extensions | a list of common text and code extensions | Which assets are opened here. One extension per line |
| Size limit (MB) | 2 | Larger files are not opened here |
| Confirm before closing | on | Ask before closing a tab with unsaved changes |
| Stash unsaved changes | on | Keep unsaved content when a tab closes and offer to restore it next time |
| Line numbers | Follow SiYuan | Whether the gutter shows line numbers |
| Restore position | on | Return to the previous scroll position and cursor |
| Remembered state | — | How many per-file choices are remembered, and a button to clear them |

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+S` / `Cmd+S` | Save the file in the active editor tab. Rebindable. |
| `Ctrl+F` / `Cmd+F` | Search inside the file |
| `Ctrl+W` / `Cmd+W` | SiYuan's own "close tab"; asks for confirmation when there are unsaved changes |

## Known limitations

These are consequences of the plugin API, not oversights.

- **Closing the whole SiYuan window cannot be intercepted.** The tab lifecycle callback SiYuan offers is synchronous and its return value is ignored, while SiYuan's confirmation dialog is asynchronous, so a close cannot be cancelled from there. Unsaved content is stashed and offered for recovery the next time the same file is opened.
- **Tab context-menu entries and batch closes are not intercepted** either: only the tab's close button, the close shortcut and double-clicking the tab are. Those paths have no interceptable event, and are covered by the same stash.
- **The file size limit cannot hand the click back to SiYuan.** Interception must happen synchronously, but the size is only known after asking the kernel. An oversized file therefore opens a tab that explains why it was not loaded and points at the link's context menu entry for opening it externally.
- **Assets in encrypted notebooks are refused.** The kernel resolves them to a temporary plaintext copy; writing that copy back would silently discard the change.
- **Highlighting reuses SiYuan's own static assets** at `/stage/protyle/js/highlight.js/` — the same script and stylesheet its code blocks use, so token classification and colours match exactly. If a future SiYuan version moves that path, highlighting degrades to plain text.
- **Highlighting recomputes the whole document on every change**, as long as one pass stays under 8 ms. How much text that budget covers depends on the content: prose and Markdown go furthest, dense code least. Larger files fall back to re-highlighting once you stop typing, so their colours settle a moment later.
- **Line numbers are CodeMirror's gutter**, restyled to SiYuan's metrics and painted with the editor background. SiYuan's own code block builds its line-number column by hand, so the two are not pixel-identical.
- **No detection of outside changes.** If another program edits the file while its tab is open, the change is not noticed until the tab is reopened.

## Development

```
npm install
npm run dev        # watch build
npm run typecheck  # tsc --noEmit
npm run build      # vite build, then package.zip at the repo root
npm run icon       # re-render assets/icon.png and assets/preview.png
npm run preview    # re-shoot assets/preview.png from assets/preview.html alone
```

## License

[MIT](./LICENSE)
