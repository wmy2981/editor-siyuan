import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Plugin} from "../support/siyuan";
import {
    CURSORS_FILE,
    DEFAULT_EXTENSIONS,
    DEFAULT_SETTINGS,
    LANGUAGES_FILE,
    STASH_FILE,
    allowedExtensions,
    dropStash,
    extensionOf,
    forgetLanguages,
    forgetMemories,
    hasAllowedExtension,
    initStore,
    normalizeSettings,
    parseExtensions,
    putStash,
    rememberCursor,
    rememberedCount,
    rememberedCursor,
    rememberedLanguage,
    rememberLanguage,
    stashedEntry,
} from "../../src/config";

const asPlugin = (plugin: Plugin): SiyuanPlugin => plugin as unknown as SiyuanPlugin;

let plugin: Plugin;

beforeEach(async () => {
    plugin = new Plugin();
    await initStore(asPlugin(plugin));
});

describe("normalizeSettings", () => {
    it("没有数据时返回全部默认值", () => {
        expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    });

    it("保留所有合法字段", () => {
        const settings = normalizeSettings({
            takeover: "altClick",
            extensions: "txt\nmd",
            maxSizeMB: 8.5,
            confirmOnClose: false,
            stashUnsaved: false,
            lineNumbers: "auto",
            lineWrap: "on",
            ligatures: "off",
            fontSize: 18,
            autocomplete: false,
            openMode: "preview",
            desktopForm: "dialog",
            restoreCursor: false,
            previewSy: true,
            codeBlockMenu: false,
            debug: true,
        });
        expect(settings).toEqual({
            takeover: "altClick",
            extensions: "txt\nmd",
            maxSizeMB: 8.5,
            confirmOnClose: false,
            stashUnsaved: false,
            lineNumbers: "auto",
            lineWrap: "on",
            ligatures: "off",
            fontSize: 18,
            autocomplete: false,
            openMode: "preview",
            desktopForm: "dialog",
            restoreCursor: false,
            previewSy: true,
            codeBlockMenu: false,
            debug: true,
        });
    });

    it("枚举字段的非法值回落到默认值", () => {
        const settings = normalizeSettings({
            takeover: "doubleClick",
            lineNumbers: "AUTO",
            lineWrap: "yes",
            ligatures: 1,
            openMode: "read",
            desktopForm: "window",
        });
        expect(settings.takeover).toBe(DEFAULT_SETTINGS.takeover);
        expect(settings.lineNumbers).toBe(DEFAULT_SETTINGS.lineNumbers);
        expect(settings.lineWrap).toBe(DEFAULT_SETTINGS.lineWrap);
        expect(settings.ligatures).toBe(DEFAULT_SETTINGS.ligatures);
        expect(settings.openMode).toBe(DEFAULT_SETTINGS.openMode);
        expect(settings.desktopForm).toBe(DEFAULT_SETTINGS.desktopForm);
    });

    it("extensions 只接受字符串", () => {
        expect(normalizeSettings({extensions: 1}).extensions).toBe(DEFAULT_SETTINGS.extensions);
        expect(normalizeSettings({extensions: null}).extensions).toBe(DEFAULT_SETTINGS.extensions);
        expect(normalizeSettings({extensions: ""}).extensions).toBe("");
    });

    it("maxSizeMB 接受数字字符串，拒绝非正数与非法值", () => {
        expect(normalizeSettings({maxSizeMB: "8"}).maxSizeMB).toBe(8);
        expect(normalizeSettings({maxSizeMB: "0.5"}).maxSizeMB).toBe(0.5);
        for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "abc", null, {}]) {
            expect(normalizeSettings({maxSizeMB: value}).maxSizeMB).toBe(DEFAULT_SETTINGS.maxSizeMB);
        }
    });

    it("fontSize 只接受正数，四舍五入并夹到上限", () => {
        expect(normalizeSettings({fontSize: 18}).fontSize).toBe(18);
        expect(normalizeSettings({fontSize: "20"}).fontSize).toBe(20);
        expect(normalizeSettings({fontSize: 18.6}).fontSize).toBe(19);
        expect(normalizeSettings({fontSize: 200}).fontSize).toBe(72);
        for (const value of [0, -1, Number.NaN, "abc", null, {}]) {
            expect(normalizeSettings({fontSize: value}).fontSize).toBe(0);
        }
    });

    it("布尔字段只认严格的 false / true", () => {
        expect(normalizeSettings({confirmOnClose: "false"}).confirmOnClose).toBe(true);
        expect(normalizeSettings({confirmOnClose: 0}).confirmOnClose).toBe(true);
        expect(normalizeSettings({confirmOnClose: false}).confirmOnClose).toBe(false);
        expect(normalizeSettings({previewSy: "true"}).previewSy).toBe(false);
        expect(normalizeSettings({previewSy: 1}).previewSy).toBe(false);
        expect(normalizeSettings({previewSy: true}).previewSy).toBe(true);
        expect(normalizeSettings({debug: "true"}).debug).toBe(false);
        expect(normalizeSettings({debug: true}).debug).toBe(true);
        expect(normalizeSettings({stashUnsaved: null}).stashUnsaved).toBe(true);
        expect(normalizeSettings({codeBlockMenu: null}).codeBlockMenu).toBe(true);
        expect(normalizeSettings({restoreCursor: null}).restoreCursor).toBe(true);
        expect(normalizeSettings({autocomplete: "false"}).autocomplete).toBe(true);
        expect(normalizeSettings({autocomplete: false}).autocomplete).toBe(false);
        expect(normalizeSettings({autocomplete: true}).autocomplete).toBe(true);
    });

    it("忽略未知字段", () => {
        const settings = normalizeSettings({unknown: "x"} as any);
        expect(settings).toEqual(DEFAULT_SETTINGS);
        expect("unknown" in settings).toBe(false);
    });
});

describe("parseExtensions", () => {
    it("按空白、逗号与分号切分", () => {
        expect(parseExtensions("txt, .md; *.JS\n\njson\ttext")).toEqual(
            new Set([".txt", ".md", ".js", ".json", ".text"]),
        );
    });

    it("统一小写并补上前导点", () => {
        expect(parseExtensions("TXT .Md *.JSON")).toEqual(new Set([".txt", ".md", ".json"]));
    });

    it("只去掉一个前导点，复合扩展名原样保留", () => {
        expect(parseExtensions("*.tar.gz .x")).toEqual(new Set([".tar.gz", ".x"]));
    });

    it("忽略空片段与重复项", () => {
        expect(parseExtensions(" , ; \n txt txt .txt ")).toEqual(new Set([".txt"]));
        expect(parseExtensions("")).toEqual(new Set());
    });

    it("默认白名单逐项可解析且没有重复", () => {
        const parsed = parseExtensions(DEFAULT_EXTENSIONS);
        expect(parsed.size).toBe(DEFAULT_EXTENSIONS.split("\n").length);
        for (const extension of parsed) {
            expect(extension).toMatch(/^\.[a-z0-9.]+$/);
        }
        expect(parsed.has(".txt")).toBe(true);
        expect(parsed.has(".tsx")).toBe(true);
        expect(parsed.has(".json5")).toBe(true);
    });
});

describe("extensionOf", () => {
    it("取小写扩展名", () => {
        expect(extensionOf("assets/README.MD")).toBe(".md");
        expect(extensionOf("assets/a.Ts")).toBe(".ts");
    });

    it("忽略查询串与片段", () => {
        expect(extensionOf("assets/a.txt?box=20210808180117")).toBe(".txt");
        expect(extensionOf("assets/a.txt#L10")).toBe(".txt");
    });

    it("没有扩展名时返回空串", () => {
        expect(extensionOf("assets/Makefile")).toBe("");
        expect(extensionOf("assets/dir.with.dot/file")).toBe("");
        expect(extensionOf("")).toBe("");
        expect(extensionOf("assets/")).toBe("");
    });

    it("点开头的文件不当作扩展名", () => {
        expect(extensionOf("assets/.gitignore")).toBe("");
        expect(extensionOf(".env")).toBe("");
    });

    it("多段扩展名只取最后一段", () => {
        expect(extensionOf("assets/archive.tar.gz")).toBe(".gz");
    });
});

describe("hasAllowedExtension", () => {
    const allowed = new Set([".txt", ".md"]);

    it("在白名单里时返回 true", () => {
        expect(hasAllowedExtension("assets/a.txt", allowed)).toBe(true);
        expect(hasAllowedExtension("assets/a.MD", allowed)).toBe(true);
    });

    it("不在白名单或没有扩展名时返回 false", () => {
        expect(hasAllowedExtension("assets/a.js", allowed)).toBe(false);
        expect(hasAllowedExtension("assets/Makefile", allowed)).toBe(false);
    });
});

describe("allowedExtensions", () => {
    it("按文本域原文缓存同一个 Set", () => {
        const raw = "cache-a\ncache-b";
        const first = allowedExtensions({...DEFAULT_SETTINGS, extensions: raw});
        const second = allowedExtensions({...DEFAULT_SETTINGS, extensions: raw});
        expect(second).toBe(first);
        expect(first).toEqual(new Set([".cache-a", ".cache-b"]));
    });

    it("原文变化后重新解析", () => {
        const first = allowedExtensions({...DEFAULT_SETTINGS, extensions: "cache-c"});
        const second = allowedExtensions({...DEFAULT_SETTINGS, extensions: "cache-d"});
        expect(second).not.toBe(first);
        expect(second).toEqual(new Set([".cache-d"]));
    });
});

describe("initStore", () => {
    it("读取并校验 languages、stash 与 cursors", async () => {
        plugin.data.set(LANGUAGES_FILE, {
            "assets/a.js": "javascript",
            "assets/b.js": "",
            "assets/c.js": 42,
        });
        plugin.data.set(STASH_FILE, {
            "assets/a.js": {text: "abc", eol: "\r\n", bom: true, at: 10},
            "assets/b.js": {text: 1, at: 2},
            "assets/c.js": {text: "abc", at: "3"},
            "assets/d.js": {text: "abc", eol: "weird", bom: "true", at: 4},
        });
        plugin.data.set(CURSORS_FILE, {
            "assets/a.js": {anchor: 1, scrollTop: 2},
            "assets/b.js": {anchor: "1", scrollTop: 2},
            "assets/c.js": {anchor: 3, scrollTop: "4"},
        });

        await initStore(asPlugin(plugin));

        expect(rememberedLanguage("assets/a.js")).toBe("javascript");
        expect(rememberedLanguage("assets/b.js")).toBeUndefined();
        expect(rememberedLanguage("assets/c.js")).toBeUndefined();

        expect(stashedEntry("assets/a.js")).toEqual({text: "abc", eol: "\r\n", bom: true, at: 10});
        expect(stashedEntry("assets/b.js")).toBeUndefined();
        expect(stashedEntry("assets/c.js")).toBeUndefined();
        expect(stashedEntry("assets/d.js")).toEqual({text: "abc", eol: "\n", bom: false, at: 4});

        expect(rememberedCursor("assets/a.js")).toEqual({anchor: 1, scrollTop: 2});
        expect(rememberedCursor("assets/b.js")).toBeUndefined();
        expect(rememberedCursor("assets/c.js")).toBeUndefined();
        expect(rememberedCount()).toBe(2);
    });

    it("存储文件缺失时按空处理", async () => {
        await initStore(asPlugin(plugin));
        expect(rememberedCount()).toBe(0);
        expect(stashedEntry("assets/a.txt")).toBeUndefined();
    });

    it("loadData 抛错时按空处理，不阻塞插件加载", async () => {
        vi.spyOn(plugin, "loadData").mockRejectedValue(new Error("read-only workspace"));
        await expect(initStore(asPlugin(plugin))).resolves.toBeUndefined();
        expect(rememberedCount()).toBe(0);
    });

    it("非对象的顶层值按空处理", async () => {
        plugin.data.set(LANGUAGES_FILE, 42);
        plugin.data.set(STASH_FILE, "text");
        plugin.data.set(CURSORS_FILE, 42);
        await initStore(asPlugin(plugin));
        expect(rememberedCount()).toBe(0);
        expect(stashedEntry("0")).toBeUndefined();
    });
});

describe("rememberLanguage", () => {
    it("记住语言并写盘", () => {
        rememberLanguage("assets/a.js", "javascript");
        expect(rememberedLanguage("assets/a.js")).toBe("javascript");
        expect(plugin.data.get(LANGUAGES_FILE)).toEqual({"assets/a.js": "javascript"});
    });

    it("值没变时不重复写盘", () => {
        rememberLanguage("assets/a.js", "javascript");
        const save = vi.spyOn(plugin, "saveData");
        rememberLanguage("assets/a.js", "javascript");
        expect(save).not.toHaveBeenCalled();
        rememberLanguage("assets/a.js", "typescript");
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("forgetLanguages 清空语言，但不影响光标", () => {
        rememberLanguage("assets/a.js", "javascript");
        rememberCursor("assets/a.js", {anchor: 1, scrollTop: 2});
        forgetLanguages();
        expect(rememberedLanguage("assets/a.js")).toBeUndefined();
        expect(rememberedCursor("assets/a.js")).toEqual({anchor: 1, scrollTop: 2});
        expect(plugin.data.get(LANGUAGES_FILE)).toEqual({});
    });
});

describe("rememberCursor", () => {
    it("记住光标位置并写盘", () => {
        rememberCursor("assets/a.js", {anchor: 5, scrollTop: 6});
        expect(rememberedCursor("assets/a.js")).toEqual({anchor: 5, scrollTop: 6});
        expect(plugin.data.get(CURSORS_FILE)).toEqual({"assets/a.js": {anchor: 5, scrollTop: 6}});
    });

    it("只保存 anchor 与 scrollTop 两个字段", () => {
        rememberCursor("assets/a.js", {anchor: 5, scrollTop: 6, extra: 1} as any);
        expect(rememberedCursor("assets/a.js")).toEqual({anchor: 5, scrollTop: 6});
    });

    it("超过上限时丢掉最早插入的记录", () => {
        for (let index = 0; index < 201; index++) {
            rememberCursor(`assets/f${index}.txt`, {anchor: index, scrollTop: 0});
        }
        expect(rememberedCursor("assets/f0.txt")).toBeUndefined();
        expect(rememberedCursor("assets/f1.txt")).toEqual({anchor: 1, scrollTop: 0});
        expect(rememberedCursor("assets/f200.txt")).toEqual({anchor: 200, scrollTop: 0});
        expect(Object.keys(plugin.data.get(CURSORS_FILE) as object)).toHaveLength(200);
    });

    it("覆盖同一路径不增加条数", () => {
        rememberCursor("assets/a.txt", {anchor: 1, scrollTop: 0});
        rememberCursor("assets/a.txt", {anchor: 2, scrollTop: 0});
        expect(rememberedCursor("assets/a.txt")).toEqual({anchor: 2, scrollTop: 0});
        expect(rememberedCount()).toBe(1);
    });
});

describe("stash", () => {
    it("putStash 保存并写盘", () => {
        putStash("assets/a.txt", {text: "abc", eol: "\n", bom: false, at: 1});
        expect(stashedEntry("assets/a.txt")).toEqual({text: "abc", eol: "\n", bom: false, at: 1});
        expect(plugin.data.get(STASH_FILE)).toEqual({
            "assets/a.txt": {text: "abc", eol: "\n", bom: false, at: 1},
        });
    });

    it("只保留最新的五份", () => {
        for (let at = 1; at <= 6; at++) {
            putStash(`assets/f${at}.txt`, {text: `${at}`, eol: "\n", bom: false, at});
        }
        expect(stashedEntry("assets/f1.txt")).toBeUndefined();
        expect(stashedEntry("assets/f2.txt")).toEqual({text: "2", eol: "\n", bom: false, at: 2});
        expect(stashedEntry("assets/f6.txt")).toEqual({text: "6", eol: "\n", bom: false, at: 6});
        expect(Object.keys(plugin.data.get(STASH_FILE) as object)).toHaveLength(5);
    });

    it("按 at 排序而不是插入顺序", () => {
        putStash("assets/old.txt", {text: "old", eol: "\n", bom: false, at: 1});
        putStash("assets/new.txt", {text: "new", eol: "\n", bom: false, at: 100});
        putStash("assets/mid.txt", {text: "mid", eol: "\n", bom: false, at: 50});
        putStash("assets/x1.txt", {text: "x", eol: "\n", bom: false, at: 2});
        putStash("assets/x2.txt", {text: "x", eol: "\n", bom: false, at: 3});
        putStash("assets/x3.txt", {text: "x", eol: "\n", bom: false, at: 4});
        expect(stashedEntry("assets/old.txt")).toBeUndefined();
        expect(stashedEntry("assets/new.txt")).toBeDefined();
        expect(stashedEntry("assets/mid.txt")).toBeDefined();
    });

    it("dropStash 只删除存在的记录", () => {
        putStash("assets/a.txt", {text: "abc", eol: "\n", bom: false, at: 1});
        const save = vi.spyOn(plugin, "saveData");
        dropStash("assets/missing.txt");
        expect(save).not.toHaveBeenCalled();
        dropStash("assets/a.txt");
        expect(stashedEntry("assets/a.txt")).toBeUndefined();
        expect(save).toHaveBeenCalledTimes(1);
    });
});

describe("forgetMemories", () => {
    it("清空语言、光标与暂存并写盘", () => {
        rememberLanguage("assets/a.js", "javascript");
        rememberCursor("assets/a.js", {anchor: 1, scrollTop: 2});
        putStash("assets/a.js", {text: "abc", eol: "\n", bom: false, at: 1});

        forgetMemories();

        expect(rememberedCount()).toBe(0);
        expect(rememberedLanguage("assets/a.js")).toBeUndefined();
        expect(rememberedCursor("assets/a.js")).toBeUndefined();
        expect(stashedEntry("assets/a.js")).toBeUndefined();
        expect(plugin.data.get(LANGUAGES_FILE)).toEqual({});
        expect(plugin.data.get(CURSORS_FILE)).toEqual({});
        expect(plugin.data.get(STASH_FILE)).toEqual({});
    });
});
