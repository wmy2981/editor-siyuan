# Editor

English | [简体中文](./README.zh-CN.md)

Open and edit the text files a note links to, inside SiYuan. The editor uses your SiYuan code font and your chosen syntax colours.

## What it does

SiYuan renders a link to a file in `assets/` as an ordinary hyperlink. Clicking it hands the file to the system default application — a text editor, or nothing at all. This plugin opens it in SiYuan instead, in a custom tab with syntax highlighting, line numbers, search, completion, undo and redo.

Three ways in:

- Click a link to an asset text file, if takeover is on (the default).
- Right-click the link and pick the plugin submenu entry, **Open with Editor**.
- Turn takeover off and use only the menu entry.

Only files in the workspace's `assets/` folder are handled. Links to absolute paths outside the workspace (`file:///...`) are left alone. The `.sy` preview only handles notes inside the workspace.

## Requirements

SiYuan 3.8.3 or later.

## Install

From the marketplace: **Settings - Marketplace - Downloaded - Plugins**, search for Editor.

Manually: unzip `package.zip` into `<workspace>/data/plugins/editor-siyuan/` and enable it.

## Formatting and minification

The **More** menu at the right end of the action bar holds **Format code** and **Minify code**. Both rewrite the whole document, both only touch the undo stack until you save, and `Ctrl+Z` takes either of them back in one step. They are unavailable in preview mode.

A note's code blocks get the same two entries under **More - Plugins**, acting on that one block and again only touching the undo stack. The block's own language decides what is offered: languages this plugin does not implement (Python, Go and so on) get no entries at all, and in a read-only document they are greyed out. The whole thing can be turned off in the settings.

| Language | Format | Minify |
| --- | --- | --- |
| JavaScript | yes | yes |
| JSON / JSONC | yes | yes |
| CSS | yes | yes |
| TypeScript / TSX, SCSS, LESS, HTML / XML / Vue, YAML, Markdown | yes | — |

Formatting uses [prettier](https://prettier.io/). JavaScript minification uses [uglify-js](https://github.com/mishoo/UglifyJS), which also mangles local variable names; CSS minification uses [csso](https://github.com/css/csso) — comments and whitespace only, no rule merging; JSON goes through `JSON.parse` + `JSON.stringify`, so comments and trailing commas in JSONC are dropped. Indentation follows SiYuan's code block tab size.

TypeScript, JSX, SCSS, LESS, HTML, YAML and Markdown have no dependable in-browser minifier, so they are format-only.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+S` / `Cmd+S` | Save the file in the active editor. Rebindable. |
| `Ctrl+F` / `Cmd+F` | Open the in-file search panel, or close it when it is open |
| `Ctrl+W` / `Cmd+W` | SiYuan's own "close tab"; asks for confirmation when there are unsaved changes |

## Known limitations

These are consequences of the plugin API, not oversights.

- **The close confirmation only covers some paths.** The tab's close button, the close shortcut and double-clicking the tab ask first; the tab context menu's close entry, batch closes and quitting SiYuan cannot be intercepted, and fall back to the stash — the next time the same file is opened you are asked whether to restore it.
- **Files over the size limit are not opened, and the click cannot be handed back to SiYuan.** Interception must happen synchronously, but the size is only known after asking the kernel; an oversized file therefore opens an editor that explains why and points at the link's context menu entry for opening it externally.
- **Assets in encrypted notebooks are refused.** The kernel resolves them to a temporary plaintext copy; writing that copy back would silently discard the change.
- **Large files settle a step late.** If one full highlight pass exceeds 8 ms it switches to re-highlighting once you stop typing, so colours land a moment later; formatting and minification run on the main thread, so a file of a few MB stalls the UI for a few seconds.
- **No detection of outside changes.** If another program edits the file, only reopening the editor shows it.
- **Completion is word-level.** It offers the current language's keywords and words already in the document. There is no syntax tree, so no type-aware, member or cross-file completion.
- **Two browser paths are left to the browser.** `Ctrl+W` closes the browser's own tab, where neither the close confirmation nor the stash can run — all the plugin can do is let `beforeunload` raise the browser's generic prompt; outside HTTPS the context menu's Paste entry is greyed out, while `Ctrl+V` in the document itself still works.
- **Mobile has no tabs and no modifier keys.** The editor is mounted in a full-screen dialog and only the × at the left end of the action bar closes it; the back key and system gestures fall back to the stash; takeover always treats a plain tap as the gesture.
- **The floating window has no close button, and a popped-out SiYuan window can only use it.** The shell is SiYuan's native dialog with only the close icon removed, so close it with `Esc` or by clicking outside it (unsaved changes are confirmed first); a window popped out of SiYuan has no tab strip, so it always uses the floating window whatever the **Desktop form** setting says.

## Bazaar Stats Graph

![Bazaar stats graph](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/editor-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

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
