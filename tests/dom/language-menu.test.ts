import {beforeEach, describe, expect, it, vi} from "vitest";
import {Menu, __setFrontend} from "../support/siyuan";
import {installHljs} from "../support/env";
import {makeT} from "../../src/i18n";
import {openLanguageMenu} from "../../src/language-menu";

const t = makeT({
    languageSearch: "搜索语言",
    languageEmpty: "没有匹配的语言",
});

let anchor: HTMLElement;

beforeEach(() => {
    installHljs({languages: ["plaintext", "javascript", "python", "rust"]});
    anchor = document.createElement("span");
    document.body.append(anchor);
});

function open(current = "javascript", onPick = vi.fn()): {menu: Menu; root: HTMLElement; search: HTMLInputElement; onPick: ReturnType<typeof vi.fn>} {
    openLanguageMenu(anchor, current, t, onPick);
    const menu = Menu.instances[Menu.instances.length - 1];
    const root = menu.element.querySelector<HTMLElement>(".editor-siyuan__lang-filter")!;
    const search = root.querySelector<HTMLInputElement>("input")!;
    return {menu, root, search, onPick};
}

const listItems = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(".b3-list-item"));

const visibleItems = (root: HTMLElement): HTMLElement[] =>
    listItems(root).filter((item) => !item.classList.contains("fn__none"));

describe("openLanguageMenu", () => {
    it("列出全部可用语言，纯文本排在最前", () => {
        const {root} = open();
        expect(listItems(root).map((item) => item.dataset.language))
            .toEqual(["plaintext", "javascript", "python", "rust"]);
    });

    it("当前语言带勾选图标", () => {
        const {root} = open("python");
        expect(root.querySelector('[data-language="python"] .b3-menu__checked')).not.toBeNull();
        expect(root.querySelector('[data-language="rust"] .b3-menu__checked')).toBeNull();
    });

    it("输入框使用 i18n 文案作为占位符", () => {
        const {search} = open();
        expect(search.placeholder).toBe("搜索语言");
    });

    it("打开时自动聚焦输入框", () => {
        const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
        open();
        expect(focus).toHaveBeenCalled();
    });

    it("移动端不自动聚焦输入框", () => {
        __setFrontend("mobile");
        const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
        open();
        expect(focus).not.toHaveBeenCalled();
    });

    it("按锚点位置打开，并给菜单一个最小宽度", () => {
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
            left: 5,
            bottom: 10,
            width: 40,
            height: 20,
            top: -10,
            right: 45,
            x: 5,
            y: -10,
            toJSON: () => ({}),
        } as DOMRect);
        const {menu} = open();
        expect(menu.openOptions).toEqual({x: 5, y: 10, h: 20, w: 40});
        expect(menu.element.style.width).toBe("260px");
        expect(menu.element.style.boxSizing).toBe("border-box");
    });

    it("锚点更宽时用锚点宽度", () => {
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
            left: 0,
            bottom: 0,
            width: 300,
            height: 10,
            top: 0,
            right: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        } as DOMRect);
        const {menu} = open();
        expect(menu.element.style.width).toBe("300px");
    });

    it("输入关键词后过滤列表，并聚焦第一项", () => {
        const {root, search} = open();
        search.value = "py";
        search.dispatchEvent(new Event("input"));

        expect(visibleItems(root).map((item) => item.dataset.language)).toEqual(["python"]);
        expect(visibleItems(root)[0].classList.contains("b3-list-item--focus")).toBe(true);
        expect(root.querySelector<HTMLElement>('[data-type="empty"]')!.classList.contains("fn__none")).toBe(true);
    });

    it("没有匹配项时显示空状态", () => {
        const {root, search} = open();
        search.value = "zzz";
        search.dispatchEvent(new Event("input"));

        expect(visibleItems(root)).toHaveLength(0);
        const empty = root.querySelector<HTMLElement>('[data-type="empty"]')!;
        expect(empty.classList.contains("fn__none")).toBe(false);
        expect(empty.textContent).toBe("没有匹配的语言");
    });

    it("清空关键词后恢复全部语言", () => {
        const {root, search} = open();
        search.value = "py";
        search.dispatchEvent(new Event("input"));
        search.value = "  ";
        search.dispatchEvent(new Event("input"));
        expect(visibleItems(root)).toHaveLength(4);
    });

    it("过滤大小写不敏感", () => {
        const {root, search} = open();
        search.value = "PY";
        search.dispatchEvent(new Event("input"));
        expect(visibleItems(root).map((item) => item.dataset.language)).toEqual(["python"]);
    });

    it("方向键在可见项之间移动，并阻止事件冒泡", () => {
        const {root, search} = open();
        const down = new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true});
        search.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(visibleItems(root)[1].classList.contains("b3-list-item--focus")).toBe(true);

        const up = new KeyboardEvent("keydown", {key: "ArrowUp", cancelable: true});
        search.dispatchEvent(up);
        expect(visibleItems(root)[0].classList.contains("b3-list-item--focus")).toBe(true);
    });

    it("方向键在首尾循环", () => {
        const {root, search} = open();
        const up = new KeyboardEvent("keydown", {key: "ArrowUp", cancelable: true});
        search.dispatchEvent(up);
        const visible = visibleItems(root);
        expect(visible[visible.length - 1].classList.contains("b3-list-item--focus")).toBe(true);
    });

    it("过滤后方向键跳过被隐藏的项", () => {
        const {root, search} = open();
        search.value = "ru";
        search.dispatchEvent(new Event("input"));
        expect(visibleItems(root).map((item) => item.dataset.language)).toEqual(["rust"]);
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true}));
        expect(visibleItems(root)[0].classList.contains("b3-list-item--focus")).toBe(true);
    });

    it("回车选中当前高亮项并关闭菜单", () => {
        const focus = vi.spyOn(anchor, "focus");
        const {menu, search, onPick} = open();
        search.value = "py";
        search.dispatchEvent(new Event("input"));
        const enter = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
        search.dispatchEvent(enter);
        expect(onPick).toHaveBeenCalledWith("python");
        expect(menu.closed).toBe(true);
        expect(focus).toHaveBeenCalled();
        expect(enter.defaultPrevented).toBe(true);
    });

    it("输入法组合期间的回车不选中", () => {
        const {search, onPick} = open();
        const enter = new KeyboardEvent("keydown", {key: "Enter", isComposing: true, cancelable: true});
        search.dispatchEvent(enter);
        expect(onPick).not.toHaveBeenCalled();
        expect(enter.defaultPrevented).toBe(false);
    });

    it("Esc 关闭菜单并交回焦点", () => {
        const focus = vi.spyOn(anchor, "focus");
        const {menu, search} = open();
        const escape = new KeyboardEvent("keydown", {key: "Escape", cancelable: true});
        search.dispatchEvent(escape);
        expect(menu.closed).toBe(true);
        expect(focus).toHaveBeenCalled();
        expect(escape.defaultPrevented).toBe(true);
    });

    it("点击列表项选中该语言", () => {
        const {root, onPick} = open();
        root.querySelector<HTMLElement>('[data-language="rust"]')!.click();
        expect(onPick).toHaveBeenCalledWith("rust");
    });

    it("点击列表空白处不选中", () => {
        const {root, onPick} = open();
        root.querySelector(".b3-list")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(onPick).not.toHaveBeenCalled();
    });

    it("键盘事件一律不再冒泡到思源的全局快捷键", () => {
        const {search} = open();
        const later = vi.fn();
        document.addEventListener("keydown", later);
        search.dispatchEvent(new KeyboardEvent("keydown", {key: "a", bubbles: true, cancelable: true}));
        expect(later).not.toHaveBeenCalled();
    });
});
