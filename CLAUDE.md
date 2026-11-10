# CLAUDE.md

Working rules for this repository. The host behaviour and design traps live in
[docs/development.md](./docs/development.md) — read that before touching the code.

## Verify

`package.json` holds the whole toolchain: after a change run `typecheck`, `typecheck:tests`, `test`
and `build`. Do not run the watch build (`dev`) — `build` covers the same ground. There is no linter
or formatter here. Build outputs are gitignored: never edit or commit them.

Verification stays static. Loading the plugin into SiYuan, real-device testing and publishing are
the maintainer's job, so never operate their SiYuan installation, including through MCP tools.
Do not push unless they ask for it.

## Conventions

- Conventional Commits in English, imperative, lowercase description (e.g. `fix(style): make the gutter opaque, drop the focus outline`). Commit in separate logical points, not one lump.
- Comments in the source are written in Chinese.
- Modules live in layers under `src/`: `core/` (settings, host access, logging, own icons), `files/` (asset links, language detection, file-type icons), `editor/` (CodeMirror assembly, completion, search panel, highlighting), `views/` (the editor view plus the tab, floating-window and mobile containers), `dialogs/`, `menus/`, `format/` (format and minify, prettier config), `styles/` (the SCSS entry and its colour schemes). Only `index.ts`, `i18n.ts`, `declarations.d.ts` and `i18n/` sit at the root — a new module belongs in the layer that owns its job, not next to the entry.
- User-facing strings are never hardcoded. Add them to both `src/i18n/en.json` and `src/i18n/zh-CN.json`, which must keep identical key sets.
- `README.md` and `README.zh-CN.md` are parallel documents: the settings table, the limitations list and the shortcut table have to be updated in both.
- Strict TypeScript with `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax`: an unreferenced local or function is a build error, not a warning. 4-space indentation, double quotes, semicolons.
- Colours, fonts and spacing in `src/styles/index.scss` come from SiYuan CSS variables (`--b3-theme-background`, `--b3-font-family-editor-code`, `--b3-border-color`, `--b3-list-hover`, ...). Never hardcode a value SiYuan already exposes.
