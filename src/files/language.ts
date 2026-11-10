/**
 * 扩展名 → hljs 语言标识。
 *
 * hljs 的语言标识不是扩展名（`py` 对应 `python`），而且部分 hljs 语言
 * 由思源的 third-languages.js 提供，未加载时会 getLanguage 失败。
 * 所以这里只做「猜一个候选」，真正用之前一律回到可用语言表里确认。
 */
import {extensionOf} from "../core/config";

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
    // 思源自己的文档格式就是 JSON
    ".sy": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".conf": "ini",
    ".env": "ini",
    ".properties": "properties",
    ".xml": "xml",
    // html 是 xml 在 hljs 里的别名：两者用同一份语法，但代码块的语言标签写的是 html，
    // 用户也是按 html 找语言的（见 issue #15），所以这里直接给别名，别退回 xml
    ".html": "html",
    ".htm": "html",
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
    ".mts": "typescript",
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

/**
 * 当前引擎实际支持的语言，按字母序。引擎未加载时只有纯文本。
 *
 * 除了规范名，也把别名一并列出：hljs 的 listLanguages() 只返回规范名，
 * 而 html、js、ts、py、sh 这些别名同样是合法的语言标识（getLanguage 认、highlight 也认），
 * 用户正是按别名找语言的。带点的别名（html.hbs 之类）是模板方言而不是可选语言，跳过。
 */
export function availableLanguages(): string[] {
    const hljs = window.hljs;
    if (!hljs) {
        return [PLAIN_TEXT];
    }
    const names = new Set<string>();
    for (const name of hljs.listLanguages()) {
        names.add(name);
        const language = hljs.getLanguage(name);
        for (const alias of language?.aliases ?? []) {
            // 撞名时 hljs 只认最后注册的那一个，所以别名必须确实指回本语言才能列
            if (!alias.includes(".") && hljs.getLanguage(alias) === language) {
                names.add(alias);
            }
        }
    }
    names.delete(PLAIN_TEXT);
    const list = Array.from(names);
    list.sort((a, b) => a.localeCompare(b));
    return [PLAIN_TEXT, ...list];
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
