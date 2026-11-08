import {beforeEach, describe, expect, it, vi} from "vitest";
import {Menu, showMessage} from "../support/siyuan";
import {makeT} from "../../src/i18n";
import {openMoreMenu} from "../../src/more-menu";
import {canFormat, canMinify, formatText, minifyText} from "../../src/format";

vi.mock("../../src/format", () => ({
    canFormat: vi.fn(),
    canMinify: vi.fn(),
    formatText: vi.fn(),
    minifyText: vi.fn(),
}));

const t = makeT({
    copy: "复制",
    copyFilePath: "复制文件路径",
    copied: "已复制",
    copyFailed: "无法写入剪贴板",
    formatCode: "格式化",
    minifyCode: "压缩",
    formatFailed: "格式化失败",
    minifyFailed: "压缩失败",
});

interface IFakeView {
    view: any;
    text: () => string;
    replaceDoc: (next: any) => void;
}

function fakeView(text: string): IFakeView {
    let doc = {toString: () => text, length: text.length};
    const view: any = {
        state: {doc},
        dispatch: vi.fn(),
    };
    return {
        view,
        text: () => doc.toString(),
        replaceDoc: (next) => {
            doc = next;
            view.state.doc = next;
        },
    };
}

const lastMenu = (): Menu => Menu.instances[Menu.instances.length - 1];

/** 装一个可用的异步剪贴板，返回它的 writeText。 */
function installClipboard(write = true): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async () => {
        if (!write) {
            throw new Error("denied");
        }
    });
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
    return writeText;
}

/** 用默认依赖打开菜单；需要时覆盖其中几项。 */
function open(overrides: Partial<Parameters<typeof openMoreMenu>[0]> = {}, x = 0, y = 0): void {
    const {view} = fakeView("abc");
    openMoreMenu({
        view,
        language: "javascript",
        link: "assets/a.js",
        apiPath: "/data/assets/a.js",
        readOnly: false,
        t,
        ...overrides,
    }, x, y);
}

beforeEach(() => {
    vi.mocked(canFormat).mockReturnValue(true);
    vi.mocked(canMinify).mockReturnValue(true);
    vi.mocked(formatText).mockResolvedValue("formatted");
    vi.mocked(minifyText).mockResolvedValue("minified");
    delete (navigator as any).clipboard;
});

describe("openMoreMenu", () => {
    it("按功能类型分组：复制两项一组，格式化与压缩一组", () => {
        open({}, 10, 20);
        const menu = lastMenu();
        expect(menu.items.map((item) => item.id)).toEqual(["copy", "copyPath", "format", "minify"]);
        expect(menu.items.map((item) => item.label)).toEqual(["复制", "复制文件路径", "格式化", "压缩"]);
        // 两组之间只有一条分隔线，组内不插
        expect(menu.element.querySelectorAll(".b3-menu__separator")).toHaveLength(1);
        expect(menu.openOptions).toEqual({x: 10, y: 20, isLeft: true});
    });

    it("复制两项用思源内置图标，格式化与压缩留空图标位", () => {
        open();
        const items = lastMenu().items;
        expect(items[0].icon).toBe("iconCopy");
        expect(items[1].icon).toBe("iconCopy");
        // 不传 iconHTML: ""：宿主的 Menu 在两项都缺省时才画那个空图标位
        for (const item of items.slice(2)) {
            expect(item.icon).toBeUndefined();
            expect(item.iconHTML).toBeUndefined();
        }
    });

    it("只读时只置灰格式化与压缩", () => {
        open({readOnly: true});
        const items = lastMenu().items;
        expect(items[0].disabled).toBeUndefined();
        expect(items[1].disabled).toBeUndefined();
        expect(items[2].disabled).toBe(true);
        expect(items[3].disabled).toBe(true);
    });

    it("没有对应实现时置灰", () => {
        vi.mocked(canFormat).mockReturnValue(false);
        vi.mocked(canMinify).mockReturnValue(false);
        open({language: "python", link: "assets/a.py"});
        expect(lastMenu().items.slice(2).every((item) => item.disabled)).toBe(true);
    });

    it("只有一种实现时只置灰另一项", () => {
        vi.mocked(canFormat).mockReturnValue(true);
        vi.mocked(canMinify).mockReturnValue(false);
        open({language: "typescript", link: "assets/a.ts"});
        const items = lastMenu().items;
        expect(items[2].disabled).toBe(false);
        expect(items[3].disabled).toBe(true);
    });

    it("复制整篇正文到剪贴板并提示", async () => {
        const writeText = installClipboard();
        const {view} = fakeView("const a = 1");
        openMoreMenu({view, language: "javascript", link: "assets/a.js", apiPath: "/data/assets/a.js", readOnly: false, t}, 0, 0);
        lastMenu().items[0].click!();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("const a = 1"));
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith("已复制", 2000));
    });

    it("复制文件路径时用工作区绝对路径", async () => {
        const writeText = installClipboard();
        open();
        lastMenu().items[1].click!();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("E:/SiYuan/data/assets/a.js"));
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith("已复制", 2000));
    });

    it("剪贴板写不进去时明确报错", async () => {
        installClipboard(false);
        const execCommand = vi.fn(() => false);
        (document as any).execCommand = execCommand;
        open();
        lastMenu().items[1].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith("无法写入剪贴板", 6000, "error"));
    });

    it("格式化成功后整篇替换，并保留一次撤销", async () => {
        const {view} = fakeView("const a=1");
        openMoreMenu({view, language: "javascript", link: "assets/a.js", apiPath: "/data/assets/a.js", readOnly: false, t}, 0, 0);
        lastMenu().items[2].click!();
        await vi.waitFor(() => expect(view.dispatch).toHaveBeenCalledTimes(1));
        expect(formatText).toHaveBeenCalledWith("javascript", "assets/a.js", "const a=1");
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: {from: 0, to: "const a=1".length, insert: "formatted"},
        });
    });

    it("压缩成功后整篇替换", async () => {
        const {view} = fakeView("  a  ");
        openMoreMenu({view, language: "css", link: "assets/a.css", apiPath: "/data/assets/a.css", readOnly: false, t}, 0, 0);
        lastMenu().items[3].click!();
        await vi.waitFor(() => expect(view.dispatch).toHaveBeenCalledTimes(1));
        expect(minifyText).toHaveBeenCalledWith("css", "assets/a.css", "  a  ");
        expect(view.dispatch).toHaveBeenCalledWith({
            changes: {from: 0, to: 5, insert: "minified"},
        });
    });

    it("计算期间文档变了就放弃结果", async () => {
        const {view, replaceDoc} = fakeView("abc");
        vi.mocked(formatText).mockImplementation(async () => {
            replaceDoc({toString: () => "changed", length: 7});
            return "formatted";
        });
        openMoreMenu({view, language: "javascript", link: "assets/a.js", apiPath: "/data/assets/a.js", readOnly: false, t}, 0, 0);
        lastMenu().items[2].click!();
        await vi.waitFor(() => expect(formatText).toHaveBeenCalled());
        await Promise.resolve();
        expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("格式化失败时展示带前缀的错误", async () => {
        vi.mocked(formatText).mockRejectedValue(new Error("boom"));
        const {view} = fakeView("abc");
        openMoreMenu({view, language: "javascript", link: "assets/a.js", apiPath: "/data/assets/a.js", readOnly: false, t}, 0, 0);
        lastMenu().items[2].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("格式化失败: boom", 6000, "error");
        expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("压缩失败时展示带前缀的错误", async () => {
        vi.mocked(minifyText).mockRejectedValue(new Error("bad css"));
        const {view} = fakeView("abc");
        openMoreMenu({view, language: "css", link: "assets/a.css", apiPath: "/data/assets/a.css", readOnly: false, t}, 0, 0);
        lastMenu().items[3].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("压缩失败: bad css", 6000, "error");
    });

    it("抛出的不是 Error 时也转成字符串", async () => {
        vi.mocked(formatText).mockRejectedValue("plain string");
        const {view} = fakeView("abc");
        openMoreMenu({view, language: "javascript", link: "assets/a.js", apiPath: "/data/assets/a.js", readOnly: false, t}, 0, 0);
        lastMenu().items[2].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("格式化失败: plain string", 6000, "error");
    });
});
