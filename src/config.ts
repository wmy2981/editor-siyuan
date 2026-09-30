/**
 * 插件设置与本地持久化。
 *
 * 三份数据分开存，互不干扰：
 * - settings.json  用户在设置面板里改的项，纯人工维护，字段缺失一律回落到默认值；
 * - languages.json 用户为某个资源手动指定的 hljs 语言，键是 `assets/xxx.txt` 链接；
 * - stash.json     关闭页签时来不及保存的正文，用于下次打开时提示恢复。
 *
 * languages 与 stash 都是插件自己写的运行时数据，必须当成不可信输入校验：
 * 用户可能直接编辑磁盘上的 json。
 */
import type {Plugin} from "siyuan";
import {baseName, stripQuery} from "./util";

export const SETTINGS_FILE = "settings.json";
export const LANGUAGES_FILE = "languages.json";
export const STASH_FILE = "stash.json";
export const CURSORS_FILE = "cursors.json";

/** 会触发接管的鼠标手势，与思源 `editor.assetOpen` 的键一致。 */
export type TTakeover = "click" | "ctrlClick" | "altClick" | "shiftClick" | "none";

/** auto 跟随思源的 `editor.codeSyntaxHighlightLineNum`。 */
export type TLineNumbers = "auto" | "show" | "hide";

/** 页签打开时的模式；preview 即操作条上的只读态。 */
export type TOpenMode = "edit" | "preview";

export interface Settings {
    /** 接管手势；none 表示点击一律交回思源，只能从右键菜单打开。 */
    takeover: TTakeover;
    /** 扩展名白名单的文本域原文，一行一个，也接受逗号、分号或空格分隔。 */
    extensions: string;
    /** 单个文件的大小上限，单位 MB。 */
    maxSizeMB: number;
    /** 关闭页签前有未保存改动时先确认。 */
    confirmOnClose: boolean;
    /** beforeDestroy 时把未保存正文暂存下来，下次打开同一文件时提示恢复。 */
    stashUnsaved: boolean;
    lineNumbers: TLineNumbers;
    /** 打开页签时先进入编辑还是只读预览。 */
    openMode: TOpenMode;
    /** 重新打开时恢复上次的滚动位置与光标。 */
    restoreCursor: boolean;
}

/**
 * 默认白名单。
 *
 * 取思源自己的资源可检索扩展名（`Constants.SIYUAN_ASSETS_SEARCH`）为底，
 * 再去掉它包进来但这里没有意义的格式，补上常见的配置文件与脚本语言。
 */
export const DEFAULT_EXTENSIONS = [
    "txt", "text", "md", "markdown", "rst", "adoc", "org",
    "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
    "csv", "tsv", "log",
    "xml", "html", "htm", "css", "scss", "sass", "less",
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte",
    "py", "rb", "php", "go", "rs", "java", "kt", "kts", "scala", "dart", "swift",
    "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "m", "mm",
    "sql", "sh", "bash", "zsh", "fish", "ps1", "psd1", "bat", "cmd",
    "gradle", "lua", "pl", "pm", "r", "jl", "clj", "ex", "exs", "erl", "hs", "ml", "nim", "zig", "proto", "graphql", "gql",
    "diff", "patch", "tex", "bib",
].join("\n");

export const DEFAULT_SETTINGS: Settings = {
    takeover: "click",
    extensions: DEFAULT_EXTENSIONS,
    maxSizeMB: 2,
    confirmOnClose: true,
    stashUnsaved: true,
    lineNumbers: "show",
    openMode: "edit",
    restoreCursor: true,
};

const TAKEOVERS: TTakeover[] = ["click", "ctrlClick", "altClick", "shiftClick", "none"];
const LINE_NUMBERS: TLineNumbers[] = ["auto", "show", "hide"];
const OPEN_MODES: TOpenMode[] = ["edit", "preview"];

const pick = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
    allowed.find((item) => item === value) ?? fallback;

/** 把磁盘或设置面板来的任意值收拢成合法设置。 */
export function normalizeSettings(raw: unknown): Settings {
    const source = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
    const maxSizeMB = Number(source.maxSizeMB);
    return {
        takeover: pick(source.takeover, TAKEOVERS, DEFAULT_SETTINGS.takeover),
        extensions: typeof source.extensions === "string" ? source.extensions : DEFAULT_SETTINGS.extensions,
        maxSizeMB: Number.isFinite(maxSizeMB) && maxSizeMB > 0 ? maxSizeMB : DEFAULT_SETTINGS.maxSizeMB,
        confirmOnClose: source.confirmOnClose !== false,
        stashUnsaved: source.stashUnsaved !== false,
        lineNumbers: pick(source.lineNumbers, LINE_NUMBERS, DEFAULT_SETTINGS.lineNumbers),
        openMode: pick(source.openMode, OPEN_MODES, DEFAULT_SETTINGS.openMode),
        restoreCursor: source.restoreCursor !== false,
    };
}

/** 文本域原文 → 带点小写扩展名集合。 */
export function parseExtensions(raw: string): Set<string> {
    const set = new Set<string>();
    for (const piece of raw.split(/[\s,;]+/)) {
        const name = piece.trim().replace(/^\*?\.?/, "").toLowerCase();
        if (name !== "") {
            set.add(`.${name}`);
        }
    }
    return set;
}

/** 取小写扩展名（含点）；没有扩展名时返回空串。 */
export function extensionOf(path: string): string {
    const name = baseName(stripQuery(path));
    const dot = name.lastIndexOf(".");
    // dot <= 0 覆盖「无扩展名」与「.gitignore 这类点开头文件」两种情况
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function hasAllowedExtension(path: string, allowed: Set<string>): boolean {
    const extension = extensionOf(path);
    return extension !== "" && allowed.has(extension);
}

// 准入判断会在每次点击与每次右键菜单里跑，文本域的解析结果按原文缓存
let cachedRaw = "";
let cachedSet = new Set<string>();

/** 取当前设置下的扩展名白名单，按文本域原文记忆。 */
export function allowedExtensions(settings: Settings): Set<string> {
    if (settings.extensions !== cachedRaw) {
        cachedRaw = settings.extensions;
        cachedSet = parseExtensions(cachedRaw);
    }
    return cachedSet;
}

export interface IStashEntry {
    text: string;
    eol: "\n" | "\r\n";
    bom: boolean;
    at: number;
}

export interface ICursorEntry {
    anchor: number;
    scrollTop: number;
}

interface IStore {
    languages: Record<string, string>;
    stash: Record<string, IStashEntry>;
    cursors: Record<string, ICursorEntry>;
}

/** 暂存条数上限：只保最近几份，避免长期使用后存储无限增长。 */
const MAX_STASH = 5;

/** 光标记忆条数上限。 */
const MAX_CURSORS = 200;

let owner: Plugin | undefined;
let store: IStore = {languages: {}, stash: {}, cursors: {}};

async function readJson(plugin: Plugin, name: string): Promise<unknown> {
    try {
        return await plugin.loadData(name);
    } catch {
        // 只读模式、首次加载、文件损坏都会走到这里，一律按空处理
        return undefined;
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function initStore(plugin: Plugin): Promise<void> {
    owner = plugin;
    const languages: Record<string, string> = {};
    for (const [path, language] of Object.entries(asRecord(await readJson(plugin, LANGUAGES_FILE)))) {
        if (typeof language === "string" && language !== "") {
            languages[path] = language;
        }
    }
    const stash: Record<string, IStashEntry> = {};
    for (const [path, entry] of Object.entries(asRecord(await readJson(plugin, STASH_FILE)))) {
        const item = asRecord(entry);
        if (typeof item.text === "string" && typeof item.at === "number") {
            stash[path] = {
                text: item.text,
                eol: item.eol === "\r\n" ? "\r\n" : "\n",
                bom: item.bom === true,
                at: item.at,
            };
        }
    }
    const cursors: Record<string, ICursorEntry> = {};
    for (const [path, entry] of Object.entries(asRecord(await readJson(plugin, CURSORS_FILE)))) {
        const item = asRecord(entry);
        if (typeof item.anchor === "number" && typeof item.scrollTop === "number") {
            cursors[path] = {anchor: item.anchor, scrollTop: item.scrollTop};
        }
    }
    store = {languages, stash, cursors};
}

const persist = (name: string, value: unknown) => owner?.saveData(name, value);

export const rememberedLanguage = (path: string): string | undefined => store.languages[path];

export function rememberLanguage(path: string, language: string): void {
    if (store.languages[path] === language) {
        return;
    }
    store.languages[path] = language;
    void persist(LANGUAGES_FILE, store.languages);
}

export function forgetLanguages(): void {
    store.languages = {};
    void persist(LANGUAGES_FILE, store.languages);
}

/** 设置面板里「已记住」的条数：语言与光标位置一起算。 */
export const rememberedCount = (): number =>
    Object.keys(store.languages).length + Object.keys(store.cursors).length;

/** 清空全部记忆：语言、光标位置，以及尚未恢复的暂存。 */
export function forgetMemories(): void {
    store.languages = {};
    store.cursors = {};
    store.stash = {};
    void persist(LANGUAGES_FILE, store.languages);
    void persist(CURSORS_FILE, store.cursors);
    void persist(STASH_FILE, store.stash);
}

export const rememberedCursor = (path: string): ICursorEntry | undefined => store.cursors[path];

export function rememberCursor(path: string, cursor: ICursorEntry): void {
    store.cursors[path] = {anchor: cursor.anchor, scrollTop: cursor.scrollTop};
    const entries = Object.entries(store.cursors);
    if (entries.length > MAX_CURSORS) {
        // 没有记录时间的字段，超出上限时按插入顺序丢最早的一半
        store.cursors = Object.fromEntries(entries.slice(entries.length - MAX_CURSORS));
    }
    void persist(CURSORS_FILE, store.cursors);
}

export const stashedEntry = (path: string): IStashEntry | undefined => store.stash[path];

export function putStash(path: string, entry: IStashEntry): void {
    store.stash[path] = entry;
    const entries = Object.entries(store.stash).sort((a, b) => b[1].at - a[1].at);
    store.stash = Object.fromEntries(entries.slice(0, MAX_STASH));
    void persist(STASH_FILE, store.stash);
}

export function dropStash(path: string): void {
    if (!(path in store.stash)) {
        return;
    }
    delete store.stash[path];
    void persist(STASH_FILE, store.stash);
}
