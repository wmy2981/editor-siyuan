import {beforeEach, describe, expect, it, vi} from "vitest";
import {readWorkspaceText, writeWorkspaceText} from "../../src/files/asset";
import {installConfig, makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {__setFrontend} from "../support/siyuan";
import {openMobileEditor} from "../../src/views/mobile";
import {openPopupEditor} from "../../src/views/popup";
import {
    ensurePrettierConfig,
    ignoredBy,
    migratePrettierConfig,
    openPrettierConfig,
    PRETTIER_FILES,
    prepareFormat,
} from "../../src/format/prettier-config";

vi.mock("../../src/files/asset", () => ({
    readWorkspaceText: vi.fn(),
    writeWorkspaceText: vi.fn(),
}));
vi.mock("../../src/views/mobile", () => ({openMobileEditor: vi.fn()}));
vi.mock("../../src/views/popup", () => ({openPopupEditor: vi.fn()}));

const t = makeT({prettierConfigInvalid: "prettier 配置不是合法的 JSON 对象"});

const CONFIG = "/data/storage/petal/editor-siyuan/.prettierrc.json";
const IGNORE = "/data/storage/petal/editor-siyuan/.prettierignore";

/** 让两个配置文件返回指定内容；传 undefined 表示文件不存在。 */
function files(config?: string, ignore?: string): void {
    vi.mocked(readWorkspaceText).mockImplementation(async (path: string) => {
        const text = path === CONFIG ? config : path === IGNORE ? ignore : undefined;
        return text === undefined ? undefined : {text, eol: "\n", bom: false};
    });
}

/** 默认配置原文，缩进取思源「代码块 Tab 空格数」。 */
const DEFAULT_TEXT = `{
    "tabWidth": 4,
    "useTabs": false
}
`;

beforeEach(() => {
    files(undefined, undefined);
    vi.mocked(writeWorkspaceText).mockResolvedValue(undefined);
});

describe("PRETTIER_FILES", () => {
    it("两个配置文件都在插件的存储目录里，允许还不存在", () => {
        expect(PRETTIER_FILES.map((file) => file.link)).toEqual([CONFIG, IGNORE]);
        expect(PRETTIER_FILES.every((file) => file.workspace === true && file.allowMissing === true)).toBe(true);
    });
});

describe("ensurePrettierConfig", () => {
    it("文件不存在时按默认值写一份", async () => {
        await ensurePrettierConfig();
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, DEFAULT_TEXT);
    });

    it("已有文件时不动它", async () => {
        files('{"singleQuote": true}', undefined);
        await ensurePrettierConfig();
        expect(writeWorkspaceText).not.toHaveBeenCalled();
    });

    it("缩进默认值跟随思源的代码块 Tab 空格数", async () => {
        installConfig({editor: {codeTabSpaces: 0}});
        await ensurePrettierConfig();
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, `{
    "tabWidth": 4,
    "useTabs": true
}
`);
    });
});

describe("ignoredBy", () => {
    const ignored = (text: string, path: string): boolean => ignoredBy(text, path);

    it("按文件名匹配", () => {
        expect(ignored("a.js", "/data/assets/a.js")).toBe(true);
        expect(ignored("a.js", "/data/assets/b.js")).toBe(false);
    });

    it("* 不跨目录，** 跨目录", () => {
        expect(ignored("*.min.js", "/data/assets/a.min.js")).toBe(true);
        expect(ignored("assets/*.js", "/data/assets/a.js")).toBe(true);
        expect(ignored("assets/*.js", "/data/assets/deep/a.js")).toBe(false);
        expect(ignored("assets/**/*.js", "/data/assets/deep/a.js")).toBe(true);
        expect(ignored("**/a.js", "/data/assets/deep/a.js")).toBe(true);
    });

    it("? 匹配单个字符", () => {
        expect(ignored("a?.js", "/data/assets/ab.js")).toBe(true);
        expect(ignored("a?.js", "/data/assets/abc.js")).toBe(false);
    });

    it("行尾斜杠只匹配目录名", () => {
        expect(ignored("vendor/", "/data/assets/vendor/a.js")).toBe(true);
        expect(ignored("vendor/", "/data/assets/a.js")).toBe(false);
    });

    it("注释与空行忽略，! 取反且后写的覆盖先写的", () => {
        expect(ignored("# a.js\n", "/data/assets/a.js")).toBe(false);
        expect(ignored("\n\n", "/data/assets/a.js")).toBe(false);
        expect(ignored("*.js\n!keep.js", "/data/assets/keep.js")).toBe(false);
        expect(ignored("*.js\n!keep.js", "/data/assets/other.js")).toBe(true);
        expect(ignored("!keep.js\n*.js", "/data/assets/keep.js")).toBe(true);
    });

    it("开头的斜杠按相对路径理解", () => {
        expect(ignored("/assets/a.js", "/data/assets/a.js")).toBe(true);
        expect(ignored("/assets/a.js", "/data/other/assets/a.js")).toBe(false);
    });
});

describe("prepareFormat", () => {
    it("没有配置文件时先写一份默认值，并用这份默认值格式化", async () => {
        expect(await prepareFormat(t, "/data/assets/a.js")).toEqual({tabWidth: 4, useTabs: false});
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, DEFAULT_TEXT);
    });

    it("读出文件里的顶层选项", async () => {
        files('{"printWidth": 120, "singleQuote": true}', undefined);
        expect(await prepareFormat(t, "/data/assets/a.js")).toEqual({printWidth: 120, singleQuote: true});
    });

    it("空文件表示一项都不设", async () => {
        files("  \n", undefined);
        expect(await prepareFormat(t)).toEqual({});
    });

    it("配置不是合法 JSON 对象时抛错", async () => {
        files("{oops}", undefined);
        await expect(prepareFormat(t)).rejects.toThrow("prettier 配置不是合法的 JSON 对象");
        files("[1, 2]", undefined);
        await expect(prepareFormat(t)).rejects.toThrow("prettier 配置不是合法的 JSON 对象");
        files("null", undefined);
        await expect(prepareFormat(t)).rejects.toThrow("prettier 配置不是合法的 JSON 对象");
    });

    it("命中 .prettierignore 时返回 undefined", async () => {
        files("{}", "*.min.js");
        expect(await prepareFormat(t, "/data/assets/a.min.js")).toBeUndefined();
        expect(await prepareFormat(t, "/data/assets/a.js")).toEqual({});
    });

    it("没有文件路径时不查 ignore", async () => {
        files("{}", "*.js");
        expect(await prepareFormat(t)).toEqual({});
    });
});

describe("migratePrettierConfig", () => {
    const LEGACY_CONFIG = "/data/.prettierrc.json";
    const LEGACY_IGNORE = "/data/.prettierignore";

    /** 按路径给文件内容：`undefined` 表示不存在；写入会更新这份状态。 */
    function tree(content: Record<string, string>): void {
        const state = {...content};
        vi.mocked(readWorkspaceText).mockImplementation(async (path: string) => {
            const text = state[path];
            return text === undefined ? undefined : {text, eol: "\n", bom: false};
        });
        vi.mocked(writeWorkspaceText).mockImplementation(async (path: string, text: string) => {
            state[path] = text;
            return undefined;
        });
    }

    it("旧版本没有配置文件时按默认值建出来，行为与升级前一致", async () => {
        tree({});
        await migratePrettierConfig();
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, DEFAULT_TEXT);
    });

    it("旧位置有配置时搬进插件目录", async () => {
        tree({[LEGACY_CONFIG]: '{"singleQuote": true}', [LEGACY_IGNORE]: "*.min.js"});
        await migratePrettierConfig();
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, '{"singleQuote": true}');
        expect(writeWorkspaceText).toHaveBeenCalledWith(IGNORE, "*.min.js");
        // 搬完就不再写默认值
        expect(writeWorkspaceText).toHaveBeenCalledTimes(2);
    });

    it("新位置已有内容时不被旧位置覆盖", async () => {
        tree({[CONFIG]: '{"printWidth": 120}', [LEGACY_CONFIG]: '{"singleQuote": true}'});
        await migratePrettierConfig();
        expect(writeWorkspaceText).not.toHaveBeenCalledWith(CONFIG, '{"singleQuote": true}');
    });

    it("旧位置是空文件时不搬，按默认值建配置", async () => {
        tree({[LEGACY_CONFIG]: "  \n"});
        await migratePrettierConfig();
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, DEFAULT_TEXT);
    });

    it("写不进去时不影响插件加载", async () => {
        vi.mocked(writeWorkspaceText).mockResolvedValue("denied");
        await expect(migratePrettierConfig()).resolves.toBeUndefined();
    });
});

describe("openPrettierConfig", () => {
    const deps = {app: {} as any, plugin: {} as any, t, settings: () => makeSettings()};

    it("桌面端用浮层，打开前先把默认配置写进文件", async () => {
        openPrettierConfig(deps);
        await vi.waitFor(() => expect(openPopupEditor).toHaveBeenCalled());
        expect(writeWorkspaceText).toHaveBeenCalledWith(CONFIG, DEFAULT_TEXT);
        expect(openPopupEditor).toHaveBeenCalledWith(
            deps,
            {link: CONFIG, workspace: true},
            ".prettierrc.json",
            PRETTIER_FILES,
        );
        expect(openMobileEditor).not.toHaveBeenCalled();
    });

    it("移动端用全屏对话框", async () => {
        __setFrontend("mobile");
        openPrettierConfig(deps);
        await vi.waitFor(() => expect(openMobileEditor).toHaveBeenCalled());
        expect(openMobileEditor).toHaveBeenCalledWith(
            deps,
            {link: CONFIG, workspace: true},
            ".prettierrc.json",
            PRETTIER_FILES,
        );
        expect(openPopupEditor).not.toHaveBeenCalled();
    });

    it("写不进默认配置时照样打开", async () => {
        vi.mocked(writeWorkspaceText).mockResolvedValue("denied");
        openPrettierConfig(deps);
        await vi.waitFor(() => expect(openPopupEditor).toHaveBeenCalled());
    });
});
