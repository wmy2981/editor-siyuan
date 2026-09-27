/**
 * 扩展名 → hljs 语言标识。
 *
 * hljs 的语言标识不是扩展名（`py` 对应 `python`），而且部分 hljs 语言
 * 由思源的 third-languages.js 提供，未加载时会 getLanguage 失败。
 * 所以这里只做「猜一个候选」，真正用之前一律回到可用语言表里确认。
 */
import {extensionOf} from "./config";

export const PLAIN_TEXT = "plaintext";

const BY_EXTENSION: Record<string, string> = {
    ".txt": PLAIN_TEXT,
    ".text": PLAIN_TEXT,
    ".csv": PLAIN_TEXT,
    ".tsv": PLAIN_TEXT,
    ".log": PLAIN_TEXT,
    ".md": "markdown",
    ".markdown": "markdown",
    ".rst": PLAIN_TEXT,
    ".adoc": "asciidoc",
    ".org": PLAIN_TEXT,
    ".json": "json",
    ".jsonc": "json",
    ".json5": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".conf": "ini",
    ".env": "ini",
    ".properties": "properties",
    ".xml": "xml",
    ".html": "xml",
    ".htm": "xml",
    ".css": "css",
    ".scss": "scss",
    ".sass": "scss",
    ".less": "less",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".vue": "xml",
    ".svelte": "xml",
    ".py": "python",
    ".rb": "ruby",
    ".php": "php",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".dart": "dart",
    ".swift": "swift",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".m": "objectivec",
    ".mm": "objectivec",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".fish": "bash",
    ".ps1": "powershell",
    ".psd1": "powershell",
    ".bat": "dos",
    ".cmd": "dos",
    ".gradle": "groovy",
    ".lua": "lua",
    ".pl": "perl",
    ".pm": "perl",
    ".r": "r",
    ".jl": "julia",
    ".clj": "clojure",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hs": "haskell",
    ".ml": "ocaml",
    ".nim": "nim",
    ".zig": "zig",
    ".proto": "protobuf",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".diff": "diff",
    ".patch": "diff",
    ".tex": "latex",
    ".bib": "latex",
};

/** 按扩展名猜一个 hljs 语言；不认识时给纯文本。 */
export function guessLanguage(path: string): string {
    return BY_EXTENSION[extensionOf(path)] ?? PLAIN_TEXT;
}

/** 当前引擎实际支持的语言，按字母序。引擎未加载时只有纯文本。 */
export function availableLanguages(): string[] {
    const hljs = window.hljs;
    if (!hljs) {
        return [PLAIN_TEXT];
    }
    const names = hljs.listLanguages().filter((name) => name !== PLAIN_TEXT);
    names.sort((a, b) => a.localeCompare(b));
    return [PLAIN_TEXT, ...names];
}

/** 把任意候选语言收拢成引擎真的认识的语言标识。 */
export function normalizeLanguage(language: string): string {
    const hljs = window.hljs;
    if (!hljs) {
        return PLAIN_TEXT;
    }
    if (language === PLAIN_TEXT || hljs.getLanguage(language)) {
        return language;
    }
    return PLAIN_TEXT;
}
