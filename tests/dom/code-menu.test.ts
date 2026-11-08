import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Menu, Plugin, ProtyleMethod, showMessage} from "../support/siyuan";
import {makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {ICON_TAB} from "../../src/icons";
import {registerCodeMenu} from "../../src/code-menu";
import {canFormat, canMinify, formatText, minifyText} from "../../src/format";
import {prepareFormat} from "../../src/prettier-config";

vi.mock("../../src/format", () => ({
    canFormat: vi.fn(),
    canMinify: vi.fn(),
    formatText: vi.fn(),
    minifyText: vi.fn(),
}));
vi.mock("../../src/prettier-config", () => ({prepareFormat: vi.fn()}));

const t = makeT({
    formatCode: "格式化代码",
    minifyCode: "压缩代码",
    formatFailed: "格式化失败",
    minifyFailed: "压缩失败",
});

let plugin: Plugin;
let settings = makeSettings();
let updateTransactionElement: ReturnType<typeof vi.fn>;

function deps() {
    return {
        plugin: plugin as unknown as SiyuanPlugin,
        t,
        settings: () => settings,
    };
}

interface IBlock {
    block: HTMLElement;
    container: HTMLElement;
    body: HTMLElement;
}

function makeBlock(language = "js", bodyText = "const a=1"): IBlock {
    const block = document.createElement("div");
    block.setAttribute("data-type", "NodeCodeBlock");
    block.innerHTML = `<div class="protyle-action__language">${language}</div>
<div class="hljs" data-render="true">
    <div class="protyle-linenumber">1</div>
    <div class="body">${bodyText}</div>
</div>`;
    document.body.append(block);
    const container = block.querySelector<HTMLElement>(".hljs")!;
    return {block, container, body: container.lastElementChild as HTMLElement};
}

function protyle(disabled = false) {
    updateTransactionElement = vi.fn();
    return {
        disabled,
        getInstance: () => ({updateTransactionElement}),
    } as any;
}

function emit(menu: Menu, block: HTMLElement, protyleInstance = protyle()) {
    plugin.eventBus.emit("click-blockicon", {
        menu,
        protyle: protyleInstance,
        blockElements: [block],
    });
    return menu;
}

beforeEach(() => {
    plugin = new Plugin();
    settings = makeSettings();
    vi.mocked(canFormat).mockReturnValue(true);
    vi.mocked(canMinify).mockReturnValue(true);
    vi.mocked(formatText).mockResolvedValue("formatted");
    vi.mocked(minifyText).mockResolvedValue("minified");
    vi.mocked(prepareFormat).mockResolvedValue({});
});

describe("registerCodeMenu", () => {
    it("设置里关闭代码块菜单时什么都不加", () => {
        settings = makeSettings({codeBlockMenu: false});
        registerCodeMenu(deps());
        const {block} = makeBlock();
        const menu = emit(new Menu(), block);
        expect(menu.items).toHaveLength(0);
    });

    it("多选块时不加菜单", () => {
        registerCodeMenu(deps());
        const first = makeBlock();
        const second = makeBlock();
        const menu = new Menu();
        plugin.eventBus.emit("click-blockicon", {
            menu,
            protyle: protyle(),
            blockElements: [first.block, second.block],
        });
        expect(menu.items).toHaveLength(0);
    });

    it("非代码块不加菜单", () => {
        registerCodeMenu(deps());
        const block = document.createElement("div");
        block.setAttribute("data-type", "NodeParagraph");
        document.body.append(block);
        expect(emit(new Menu(), block).items).toHaveLength(0);
    });

    it("语言不在支持表里时不加菜单", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock("python");
        expect(emit(new Menu(), block).items).toHaveLength(0);
    });

    it("没有语言标签时不加菜单", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock();
        block.querySelector(".protyle-action__language")!.remove();
        expect(emit(new Menu(), block).items).toHaveLength(0);
    });

    it("没有 .hljs 正文时不加菜单", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock();
        block.querySelector(".hljs")!.remove();
        expect(emit(new Menu(), block).items).toHaveLength(0);
    });

    it("正文没有子元素时不加菜单", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock();
        block.querySelector(".hljs")!.innerHTML = "";
        expect(emit(new Menu(), block).items).toHaveLength(0);
    });

    it("代码块语言映射成 hljs 语言与合成链接", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock(" TSX ");
        emit(new Menu(), block);
        expect(canFormat).toHaveBeenCalledWith("typescript", "code.tsx");
        expect(canMinify).toHaveBeenCalledWith("typescript", "code.tsx");
    });

    it("支持的语言渲染两项，使用插件图标", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock();
        const menu = emit(new Menu(), block);
        expect(menu.items.map((item) => item.id)).toEqual(["editorSiyuanFormat", "editorSiyuanMinify"]);
        expect(menu.items.map((item) => item.label)).toEqual(["格式化代码", "压缩代码"]);
        expect(menu.items.every((item) => item.icon === ICON_TAB)).toBe(true);
        expect(menu.items.every((item) => item.disabled === false)).toBe(true);
    });

    it("只读文档里两项都置灰但仍然出现", () => {
        registerCodeMenu(deps());
        const {block} = makeBlock();
        const menu = emit(new Menu(), block, protyle(true));
        expect(menu.items).toHaveLength(2);
        expect(menu.items.every((item) => item.disabled)).toBe(true);
    });

    it("只有格式化实现时压缩置灰", () => {
        vi.mocked(canMinify).mockReturnValue(false);
        registerCodeMenu(deps());
        const {block} = makeBlock();
        const menu = emit(new Menu(), block);
        expect(menu.items[0].disabled).toBe(false);
        expect(menu.items[1].disabled).toBe(true);
    });

    it("格式化成功后写回 DOM、提交事务并重新高亮", async () => {
        registerCodeMenu(deps());
        const {block, container, body} = makeBlock("js", "const a=1");
        const menu = emit(new Menu(), block);
        const oldHTML = block.outerHTML;
        menu.items[0].click!();
        await vi.waitFor(() => expect(updateTransactionElement).toHaveBeenCalled());

        expect(formatText).toHaveBeenCalledWith("javascript", "code.js", "const a=1", {});
        expect(body.textContent).toBe("formatted\n");
        expect(container.hasAttribute("data-render")).toBe(false);
        expect(updateTransactionElement).toHaveBeenCalledWith(block, oldHTML);
        expect(ProtyleMethod.highlightRender).toHaveBeenCalledWith(block);
    });

    it("压缩成功后同样写回，并补一个尾随换行", async () => {
        registerCodeMenu(deps());
        const {block, body} = makeBlock("css", "a { color: red; }");
        const menu = emit(new Menu(), block);
        menu.items[1].click!();
        await vi.waitFor(() => expect(updateTransactionElement).toHaveBeenCalled());
        expect(minifyText).toHaveBeenCalledWith("css", "code.css", "a { color: red; }");
        expect(body.textContent).toBe("minified\n");
    });

    it("正文已经以换行结尾时不再补", async () => {
        vi.mocked(formatText).mockResolvedValue("formatted\n");
        registerCodeMenu(deps());
        const {block, body} = makeBlock("js", "const a=1");
        emit(new Menu(), block).items[0].click!();
        await vi.waitFor(() => expect(updateTransactionElement).toHaveBeenCalled());
        expect(body.textContent).toBe("formatted\n");
    });

    it("结果与现有正文相同时跳过提交", async () => {
        vi.mocked(formatText).mockResolvedValue("const a=1\n");
        registerCodeMenu(deps());
        const {block} = makeBlock("js", "const a=1\n");
        emit(new Menu(), block).items[0].click!();
        await vi.waitFor(() => expect(formatText).toHaveBeenCalled());
        await Promise.resolve();
        expect(updateTransactionElement).not.toHaveBeenCalled();
        expect(ProtyleMethod.highlightRender).not.toHaveBeenCalled();
    });

    it("计算期间块被移除时放弃结果", async () => {
        vi.mocked(formatText).mockImplementation(async () => {
            document.body.innerHTML = "";
            return "formatted";
        });
        registerCodeMenu(deps());
        const {block} = makeBlock();
        emit(new Menu(), block).items[0].click!();
        await vi.waitFor(() => expect(formatText).toHaveBeenCalled());
        await Promise.resolve();
        expect(updateTransactionElement).not.toHaveBeenCalled();
    });

    it("格式化失败时提示并保留原文", async () => {
        vi.mocked(formatText).mockRejectedValue(new Error("boom"));
        registerCodeMenu(deps());
        const {block, body} = makeBlock("js", "const a=1");
        emit(new Menu(), block).items[0].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("格式化失败: boom", 6000, "error");
        expect(body.textContent).toBe("const a=1");
        expect(updateTransactionElement).not.toHaveBeenCalled();
    });

    it("压缩失败时提示并保留原文", async () => {
        vi.mocked(minifyText).mockRejectedValue(new Error("bad css"));
        registerCodeMenu(deps());
        const {block} = makeBlock("css", "a{}");
        emit(new Menu(), block).items[1].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("压缩失败: bad css", 6000, "error");
    });

    it("抛出的不是 Error 时也转成字符串", async () => {
        vi.mocked(formatText).mockRejectedValue("plain");
        registerCodeMenu(deps());
        const {block} = makeBlock();
        emit(new Menu(), block).items[0].click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("格式化失败: plain", 6000, "error");
    });
});
