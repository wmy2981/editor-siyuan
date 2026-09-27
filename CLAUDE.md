# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run typecheck` — `tsc --noEmit`. Run after touching `src/`.
- `npm run build` — `vite build && node scripts/build-package.mjs`. Also writes `package.zip` at the repo root; that zip is the installable plugin package. Run after typecheck for anything that can affect bundling.
- `npm run icon` — re-renders `assets/icon.png` from `assets/icon.svg`, then re-shoots `assets/preview.png`. Needs Chromium for Playwright (`npx playwright install chromium`, once per machine).
- `npm run preview` — re-shoots `assets/preview.png` from `assets/preview.html` alone.

There is no test framework, linter or formatter here, and no config for one. Do not add one unprompted. Verification is `npm run typecheck` plus `npm run build`; loading the plugin into SiYuan is the maintainer's job, so never operate their SiYuan installation, including through MCP tools.

`npm run dev` is a watch build — don't start it, `npm run build` covers the same ground. Do not push: the maintainer decides when a release happens.

## Build constraints

The bundle must stay **CommonJS**. SiYuan's loader wraps plugin code in `(function anonymous(require, module, exports){...})` and evaluates it, so ESM output dies at runtime with `SyntaxError: Cannot use import statement outside a module`. Keep `formats: ["cjs"]`, the `index.js` entry and `siyuan` external in `vite.config.ts`.

`dist/`, `package.zip`, `index.js`, `index.css`, `kernel.js` and `/i18n` are build outputs and gitignored. Never edit or commit them.

`scripts/build-package.mjs` renames on the way into the package: `README.zh-CN.md` → `README_zh_CN.md`, `src/i18n/` → `i18n/`.

## Manifest constraints

- `plugin.json` `name` must equal the install directory name (`editor-siyuan`).
- `plugin.json` and `package.json` versions must match — CI fails when they differ — and must be higher than the latest `v*` tag before a release is published.
- `minAppVersion` must stay at or below the version the maintainer runs (3.8.6-alpha.5). The kernel compares with `semver.Compare`, so `3.8.6` is *greater* than `3.8.6-alpha.5` and would block installation. 3.8.3 is deliberate, not stale.
- `frontends` accepts only `desktop`, `desktop-window`, `mobile`, `browser-desktop`, `browser-mobile`, `all`. Windows/macOS/Linux are `backends` values (`windows`, `linux`, `darwin`, ...).
- There is no `libs` field. Third-party libraries have to be bundled into `index.js`.

## SiYuan API facts the design depends on

- Register the tab with `plugin.addTab({type})` and open it with `openTab({custom: {id: plugin.name + type}})`. The id must be exactly `plugin.name + type`; on the next start SiYuan deletes custom tabs whose id has no registered factory.
- A tab close **cannot** be cancelled from `beforeDestroy`: it is synchronous and its return value is ignored, while SiYuan's confirmation dialog is asynchronous. That is why `src/close-guard.ts` intercepts the close button, the close hotkey and tab double-click in the capture phase, and why every other close path falls back to stashing the buffer. Don't "simplify" it back into the lifecycle callback.
- Assets are reachable only through workspace-relative paths (`/api/asset/resolveAssetPath` → `/api/file/getFile` / `/api/file/putFile`); the kernel rejects paths outside the workspace. Writing needs the administrator role.
- Highlighting reuses SiYuan's own highlight.js and its theme stylesheet under `/stage/protyle/js/highlight.js/`. The injected `<link>` id must not be `protyleHljsStyle` — SiYuan removes that element when the code theme changes.
- CodeMirror's base theme emits every rule as `.ͼN .sel` (specificity 0,2,0) and mounts after the plugin stylesheet, so plugin SCSS needs three-class selectors (`.editor-siyuan .cm-editor .cm-gutters`) to win. Rules written with `&light` / `&dark` gain another class (`.ͼN.cm-light .cm-panels`), so those need four. Do not reach for `!important`.
- The find panel is replaced, not restyled: `search({createPanel})` supplies `src/search.ts`. Its search input must keep `main-field="true"` — `openSearchPanel` looks the field up by that attribute to refocus it when the panel is already open. CodeMirror also gives `.cm-panels` `position: sticky; z-index: 300`; both must be reset or the panel paints over SiYuan's own chrome.
- Editor menus are built with `Menu` from `siyuan`, which drives the host's `#commonMenu`. SiYuan's own editor context menu cannot be reused: it hangs off ProseMirror's `open-menu-content`, and its text-input path goes to Electron's main process. Cut/copy/paste go through `document.execCommand`, the same calls SiYuan makes.
- A plugin command needs `execute` and must not define `globalCallback`/`fileTreeCallback`/`editorCallback`/`dockCallback`, or SiYuan's `source: "shortcut"` dispatch never fires.

## Conventions

- Conventional Commits in English, imperative, lowercase description (e.g. `fix(style): make the gutter opaque, drop the focus outline`). Commit in separate logical points, not one lump.
- Comments in the source are written in Chinese.
- User-facing strings are never hardcoded. Add them to both `src/i18n/en.json` and `src/i18n/zh-CN.json`, which must keep identical key sets.
- Strict TypeScript with `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax`: an unreferenced local or function is a build error, not a warning. 4-space indentation, double quotes, semicolons.
- Colours, fonts and spacing in `src/index.scss` come from SiYuan CSS variables (`--b3-theme-background`, `--b3-font-family-editor-code`, `--b3-border-color`, `--b3-list-hover`, ...). Never hardcode a value SiYuan already exposes.
