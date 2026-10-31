/**
 * 测试环境：思源的运行时配置、highlight.js 替身，以及 fetch / Response 的小工具。
 *
 * 所有状态都挂在 window 上，与 src 的取值方式一致（`window.siyuan.config`、
 * `window.hljs`）。setup.ts 在每个测试前重新安装默认值，测试里可以再覆盖。
 */
import {vi} from "vitest";
import {DEFAULT_SETTINGS, type Settings} from "../../src/config";

/** 覆盖项按对象递归合并；数组整体替换。 */
function merge<T>(base: T, overrides: unknown): T {
    if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
        return overrides as T;
    }
    if (base === null || typeof base !== "object" || Array.isArray(base)) {
        return overrides as T;
    }
    const result: Record<string, unknown> = {...(base as Record<string, unknown>)};
    for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
        if (value === undefined) {
            continue;
        }
        result[key] = merge((base as Record<string, unknown>)[key], value);
    }
    return result as T;
}

/** 与 src 读取的字段一一对应；测试只覆盖关心的那几项。 */
export function baseConfig(): Record<string, any> {
    return {
        system: {
            os: "windows",
            workspaceDir: "E:/SiYuan",
        },
        readonly: false,
        appearance: {
            mode: 1,
            codeBlockThemeLight: "default",
            codeBlockThemeDark: "github-dark",
        },
        editor: {
            codeTabSpaces: 4,
            codeLineWrap: true,
            codeLigatures: false,
            codeSyntaxHighlightLineNum: false,
        },
        keymap: {
            general: {
                closeTab: {custom: "⌘W"},
            },
        },
        fileTree: {
            closeTabOnDoubleClick: true,
        },
    };
}

export function installConfig(overrides: Record<string, any> = {}): void {
    (window as any).siyuan = {config: merge(baseConfig(), overrides)};
}

/** 取当前安装的配置，测试里就地改一项时用。 */
export function currentConfig(): Record<string, any> {
    return (window as any).siyuan.config;
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
    return {...DEFAULT_SETTINGS, ...overrides};
}

export interface IHljsCall {
    code: string;
    language: string;
    ignoreIllegals?: boolean;
}

export interface IHljsMockOptions {
    languages?: string[];
    /**
     * 语言别名，与 hljs 一致：别名与规范名解析到同一个对象。
     * 只有需要断言「语言列表里出现别名」的测试才传。
     */
    aliases?: Record<string, string[]>;
    /** 关键字定义，形态与 hljs 一致，供补全的测试用。 */
    keywords?: Record<string, unknown>;
    highlight?: (code: string, options: {language: string; ignoreIllegals?: boolean}) => any;
}

export const DEFAULT_LANGUAGES = [
    "plaintext",
    "javascript",
    "typescript",
    "json",
    "css",
    "scss",
    "less",
    "xml",
    "yaml",
    "markdown",
    "python",
    "bash",
];

/**
 * 装一个最小可用的 hljs。默认把整段正文当成一个无 scope 的文本节点返回，
 * 需要断言装饰时由测试传 highlight 自己给 token 树。
 */
export function installHljs(options: IHljsMockOptions = {}): {calls: IHljsCall[]} {
    const languages = options.languages ?? DEFAULT_LANGUAGES;
    const aliases = options.aliases ?? {};
    const calls: IHljsCall[] = [];
    // 每门语言只有一个对象：hljs 就是这样让别名与规范名指向同一个定义，
    // 调用方（比如 language.ts 列语言时）靠它判断别名有没有撞到别的语言。
    const definitions = new Map(languages.map((name) => [name, {
        name,
        aliases: aliases[name],
        keywords: options.keywords?.[name],
    }]));
    const resolve = (name: string) => definitions.get(name) ?? Array.from(definitions.values())
        .find((definition) => definition.aliases?.includes(name));
    (window as any).hljs = {
        highlight(code: string, opts: {language: string; ignoreIllegals?: boolean}) {
            calls.push({code, language: opts.language, ignoreIllegals: opts.ignoreIllegals});
            if (options.highlight) {
                return options.highlight(code, opts);
            }
            return {value: code, _emitter: {rootNode: {children: [code]}}};
        },
        getLanguage(name: string) {
            return resolve(name);
        },
        listLanguages() {
            return [...languages];
        },
    };
    return {calls};
}

export function uninstallHljs(): void {
    delete (window as any).hljs;
}

/** fetch 的 JSON 信封响应。 */
export function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
}

/** 文件读取接口成功时返回裸字节。 */
export function binaryResponse(bytes: Uint8Array, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({}),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
}

export function stubFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
    const mock = vi.fn(handler);
    vi.stubGlobal("fetch", mock);
    return mock;
}

/** 编码 UTF-8 文本，读响应体时用。 */
export function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}
