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
- On mobile, `addTab` and `openTab` are compiled out entirely, so the editor has to be mounted in a `Dialog`. Keeping one view for both hosts is why it takes an `IViewHost`.
- A tab close **cannot** be cancelled from `beforeDestroy`: it is synchronous and its return value is ignored, while SiYuan's confirmation dialog is asynchronous. That is why the close button, the close hotkey and tab double-click are intercepted in the capture phase, and why every other close path falls back to stashing the buffer. Don't fold it back into the lifecycle callback.
- SiYuan's global keydown destroys the topmost dialog unconditionally, so any dialog that has to confirm before closing must take `Escape` in the capture phase — and must skip it while a confirmation of its own is open.
- `getFrontend()` returns `desktop-window` inside a window popped out of SiYuan: no tab strip there, so the editor can only open in a dialog.

## Kernel APIs

- Assets are reachable only through workspace-relative paths (`/api/asset/resolveAssetPath` → `/api/file/getFile` / `/api/file/putFile`); the kernel rejects paths outside the workspace, and writing needs the administrator role.
- `/api/system/getConf` blanks `system.workspaceDir` (and the other absolute paths) for browser requests — the kernel treats any UA without the `SiYuan/` prefix as a browser. Falling back to `/api/system/getWorkspaceInfo` (admin-only, the same role the asset APIs need) is what makes Docker work; nothing else may read `workspaceDir`.

## Editor

- Highlighting reuses SiYuan's own highlight.js and the theme stylesheet under `/stage/protyle/js/highlight.js/`. The injected `<link>` id must not be `protyleHljsStyle` — SiYuan removes that element when the code theme changes.
- Highlight ranges are read from hljs's private `_emitter.rootNode`. That field is undocumented, so the HTML-parsing fallback has to stay.
- `html` is only an alias of `xml` in hljs, so `listLanguages()` never returns it. A code block's font size is 85% of `--b3-font-size-editor`; there is no separate code-size variable.
- CodeMirror's base theme emits every rule as `.ͼN .sel` (specificity 0,2,0) and mounts after the plugin stylesheet, so plugin SCSS needs three-class selectors to win, and four where `&light` / `&dark` adds another class. Do not reach for `!important`.
- The find panel is replaced, not restyled: `search({createPanel})` supplies it, and its search input must keep `main-field="true"` — that is the attribute `openSearchPanel` uses to find the field. CodeMirror also gives `.cm-panels` `position: sticky; z-index: 300`; both must be reset or the panel paints over SiYuan's own chrome.
- `drawSelection()` hides the browser's native caret and selection, then draws its own from `state.selection`. That only works while the view reports focus, and CodeMirror ignores touch for selection (`mousedown` returns early after a touch) and only draws handles on iOS. On touch the editor therefore keeps the native caret, native selection and OS handles: `createEditor` takes `drawSelection`, and view.ts passes `false` on mobile.
- The content DOM must set `-webkit-user-select: text` as well as `user-select: text`. WebKit inherits the prefixed property separately, so an ancestor's `-webkit-user-select: none` keeps the content unselectable even when the unprefixed property says otherwise.
- Read-only keeps the soft keyboard down with `inputmode="none"` only. Never add `virtualkeyboardpolicy="manual"`: that policy rides the host's input connection, and on Android WebView it takes the native caret and selection with it — tapping the body in preview then produces neither, while the editable mode on the same device is fine. The two modes' DOM differ by that attribute alone, which is what made the regression so hard to see.
- Editor menus go through `Menu` from `siyuan`, which drives the host's `#commonMenu`. SiYuan's own editor context menu cannot be reused: it hangs off ProseMirror's `open-menu-content`, and its text-input path goes to Electron's main process. Cut/copy/paste go through `document.execCommand`, the same calls SiYuan makes.
- In the dark theme `--b3-theme-on-surface-light` is *brighter* than `--b3-theme-on-surface`, so it cannot be used to dim anything; SiYuan dims a disabled icon with `opacity: .38`.
- SiYuan's dialog container does not clip its children, and the resize grips sit *outside* its box, so a full-bleed child paints over the rounded corners — round the child instead of clipping the container.
- A plugin command needs `execute` and must not define `globalCallback` / `fileTreeCallback` / `editorCallback` / `dockCallback`, or SiYuan's `source: "shortcut"` dispatch never fires.
