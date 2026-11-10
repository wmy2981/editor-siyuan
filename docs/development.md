# Development notes

Host behaviour and traps that cost time to find. Anything a reader can get by opening a file in
this repository is left out.

## Build

- The bundle must stay **CommonJS**: SiYuan wraps plugin code in `(function anonymous(require, module, exports){...})` and evaluates it, so ESM output dies at runtime with `SyntaxError: Cannot use import statement outside a module`. Keep `formats: ["cjs"]` and the `index.js` entry.
- `siyuan` must stay external — the host injects it, and the manifest has no `libs` field, so every third-party library ends up in `index.js`.

## Manifest

- `plugin.json` and `package.json` versions must match (CI fails when they differ) and must be higher than the latest `v*` tag before a release is published.
- `minAppVersion` must stay at or below the version the maintainer runs (3.8.6-alpha.5). The kernel compares with `semver.Compare`, so `3.8.6` is *greater* than `3.8.6-alpha.5` and would block installation. 3.8.3 is deliberate, not stale.

## Host

- A custom tab's id must be exactly `plugin.name + type`: on the next start SiYuan deletes custom tabs whose id has no registered factory.
- A view that switches the file it shows must update two host-side things: the tab title through `tab.updateTitle`, and `custom.data.link`, which is what the close guard and the "already open, just focus it" check read. The mobile and floating-window hosts instead own a dialog title bar, so they pass `onSwitch` to rewrite it.
- On mobile, `addTab` and `openTab` are compiled out entirely, so the editor has to be mounted in a `Dialog`. Keeping one view for both hosts is why it takes an `IViewHost`.
- A tab close **cannot** be cancelled from `beforeDestroy`: it is synchronous and its return value is ignored, while SiYuan's confirmation dialog is asynchronous. That is why the close button, the close hotkey and tab double-click are intercepted in the capture phase, and why every other close path falls back to stashing the buffer. Don't fold it back into the lifecycle callback.
- SiYuan's global keydown destroys the topmost dialog unconditionally, so any dialog that has to confirm before closing must take `Escape` in the capture phase — and must skip it while a confirmation of its own is open.
- `getFrontend()` returns `desktop-window` inside a window popped out of SiYuan: no tab strip there, so the editor can only open in a dialog.
- The settings panel is built on the host `Setting` (rows with `createActionElement`, saved on `confirmCallback`) rather than on a hand-made `Dialog`, so SiYuan owns the shell: a centred dialog on desktop, its own bottom drawer on mobile, with its own drag/back/keyboard handling. Rebuilding the dialog by hand puts the panel back outside that treatment. Two host behaviours still have to be handled by the plugin: `Setting.open()` mounts the dialog and may focus a control inside it (the mobile host turns that into a soft keyboard and a full reflow, hence the prototype guard around the synchronous open), and the container plus the scrolling `.b3-dialog__content` need the `will-change` layer hint. A `Setting` accumulates items and has no reset, so open a fresh one per `openSetting()` call — values are then read from the current settings through `createActionElement`.

## Formatting

- prettier ships as the browser build here, so `resolveConfig` and the ignore machinery do not exist. The plugin reads `.prettierrc.json` and `.prettierignore` from its own data folder, `data/storage/petal/editor-siyuan/` (raw `/api/file/*` access to it is allowed — the kernel only blocks the plugin, widget and template folders): the parsed object is spread into `prettier.format`'s options and `parser` / `plugins` are then written back, and ignore patterns go through the gitignore subset in `src/format/prettier-config.ts`.
- The config file is seeded with the plugin's defaults (`tabWidth` / `useTabs` from SiYuan's code block tab size) the first time formatting or the config editor needs it, and after that the file is the only source of options — `src/format/format.ts` keeps no defaults of its own. Both files may be missing, which is why workspace resolution takes `allowMissing` and treats a missing file as empty instead of failing.
- Plugin load seeds the config too, so an upgrade from a version without one leaves the user with the same indentation as before plus a file they can edit. Files that earlier builds wrote to the workspace's `data/` root are copied into the plugin folder when the new location has no content; the originals are left alone.
- Ignore patterns are matched against the path relative to `data/` (`assets/a.js`), not relative to the ignore file's own directory: the file lives in the plugin folder, while the files it governs are under `data/assets/`, so gitignore's own relative-to-self rule would match nothing.

## File icons

- The icons are VS Code's default file icon theme, `vs-seti`, which is a font (`seti.woff`) plus a mapping table (`vs-seti-icon-theme.json`), both MIT. SiYuan only renders icons from `<symbol>` definitions, so `scripts/build-file-icons.py` converts every glyph the table references into an SVG path, writes the theme's `fontColor` onto it and writes `src/files/file-icons.ts`. That file is generated: refresh it with
  `python scripts/build-file-icons.py --font seti.woff --theme vs-seti-icon-theme.json --out src/files/file-icons.ts --commit <sha>`
  (needs `fonttools`); the two inputs come from `extensions/theme-seti/icons/` at that commit.
- Seti's `_c`, `_c_1` and `_c_2` are the same glyph with different `fontColor` (C source, C header, Objective-C). The generator keeps one symbol per glyph/colour pair, so those files differ in colour; `_todo` has no `fontColor` and falls back to `currentColor`. Only the default colours are generated — the JSON's light-theme variants differ slightly and are not shipped.
- Resolution follows VS Code: exact file name, then the longest extension suffix (`a.spec.ts` before `a.ts`), then the language. `src/files/file-icon.ts` holds the hljs-to-VS-Code language translation, because Seti's `languageIds` uses VS Code ids while `guessLanguage` returns hljs ids, plus the extensionless names VS Code resolves by language (`Dockerfile`, `Makefile`, `.gitignore`). Anything unmatched falls back to `ICON_TAB`.
- A custom tab's icon cannot be changed through the SDK: `Tab` exposes only `updateTitle`. `updateTabIcon` writes the public `icon` field and the head element's `<use xlink:href>`; both have to move together when the file switcher changes files.

## Kernel APIs

- Assets are reachable only through workspace-relative paths (`/api/asset/resolveAssetPath` → `/api/file/getFile` / `/api/file/putFile`); the kernel rejects paths outside the workspace, and writing needs the administrator role.
- `/api/system/getConf` blanks `system.workspaceDir` (and the other absolute paths) for browser requests — the kernel treats any UA without the `SiYuan/` prefix as a browser. Falling back to `/api/system/getWorkspaceInfo` (admin-only, the same role the asset APIs need) is what makes Docker work; nothing else may read `workspaceDir`.

## Editor

- Highlighting reuses SiYuan's own highlight.js and the theme stylesheet under `/stage/protyle/js/highlight.js/`. The injected `<link>` id must not be `protyleHljsStyle` — SiYuan removes that element when the code theme changes.
- SiYuan rewrites the theme's base rule from `.hljs{background;color}` to `.code-block{background;color}`. Token rules stay global, but those two colours never reach plugin DOM: `.code-block` is a host block class that must not be reused (host code and themes key off it). Follow mode therefore reads the computed colour and background of a throwaway `.protyle-wysiwyg > .code-block` probe and writes them to `--editor-siyuan-code-color` / `--editor-siyuan-code-background`, so nothing is hardcoded and light-theme rules such as a translucent code block background come along. Stylesheets load asynchronously, so the probe repeats on every stylesheet `load` event (capture phase; `load` does not bubble).
- Highlight ranges are read from hljs's private `_emitter.rootNode`. That field is undocumented, so the HTML-parsing fallback has to stay.
- `html` is only an alias of `xml` in hljs, so `listLanguages()` never returns it. A code block's font size is 85% of `--b3-font-size-editor`; there is no separate code-size variable.
- hljs's scope names do not mean what they read as: TypeScript variable declarations, JSON keys and ini setting names all come out as `attr`, and type names such as `number` and `string` come out as `built_in`. The bundled colour schemes are grouped by that real distribution, so check what the engine emits before mapping a scope by name.
- CodeMirror's base theme emits every rule as `.ͼN .sel` (specificity 0,2,0) and mounts after the plugin stylesheet, so plugin SCSS needs three-class selectors to win, and four where `&light` / `&dark` adds another class. Do not reach for `!important`.
- The find panel is replaced, not restyled: `search({createPanel})` supplies it, and its search input must keep `main-field="true"` — that is the attribute `openSearchPanel` uses to find the field. CodeMirror also gives `.cm-panels` `position: sticky; z-index: 300`; both must be reset or the panel paints over SiYuan's own chrome.
- `drawSelection()` hides the browser's native caret and selection, then draws its own from `state.selection`. That only works while the view reports focus, and CodeMirror ignores touch for selection (`mousedown` returns early after a touch) and only draws handles on iOS. On touch the editor therefore keeps the native caret, native selection and OS handles: `createEditor` takes `drawSelection`, and `src/views/view.ts` passes `false` on mobile.
- The content DOM must set `-webkit-user-select: text` as well as `user-select: text`. WebKit inherits the prefixed property separately, so an ancestor's `-webkit-user-select: none` keeps the content unselectable even when the unprefixed property says otherwise.
- Read-only keeps the soft keyboard down with `inputmode="none"` only. Never add `virtualkeyboardpolicy="manual"`: that policy rides the host's input connection, and on Android WebView it takes the native caret and selection with it — tapping the body in preview then produces neither, while the editable mode on the same device is fine. The two modes' DOM differ by that attribute alone, which is what made the regression so hard to see.
- Editor menus go through `Menu` from `siyuan`, which drives the host's `#commonMenu`. SiYuan's own editor context menu cannot be reused: it hangs off ProseMirror's `open-menu-content`, and its text-input path goes to Electron's main process. Cut/copy/paste go through `document.execCommand`, the same calls SiYuan makes.
- In the dark theme `--b3-theme-on-surface-light` is *brighter* than `--b3-theme-on-surface`, so it cannot be used to dim anything; SiYuan dims a disabled icon with `opacity: .38`.
- SiYuan's dialog container does not clip its children, and the resize grips sit *outside* its box, so a full-bleed child paints over the rounded corners — round the child instead of clipping the container.
- A plugin command needs `execute` and must not define `globalCallback` / `fileTreeCallback` / `editorCallback` / `dockCallback`, or SiYuan's `source: "shortcut"` dispatch never fires.
