import {afterEach, describe, expect, it, vi} from "vitest";
import {Compartment, EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {
    getSearchQuery,
    openSearchPanel,
    SearchQuery,
    searchPanelOpen,
    setSearchQuery,
} from "@codemirror/search";
import {makeT} from "../../src/i18n";
import {createEditor} from "../../src/editor";
import {closeSearch, siyuanSearch, toggleSearchPanel} from "../../src/search";

const t = makeT({
    searchPlaceholder: "查找",
    replacePlaceholder: "替换为",
    searchCase: "区分大小写",
    searchWord: "全词匹配",
    searchRegex: "正则",
    searchPrevious: "上一个",
    searchNext: "下一个",
    searchClose: "关闭",
    replace: "替换",
    replaceAll: "全部替换",
});

const views: EditorView[] = [];

function makeEditor(doc = "foo foo", readOnly = false): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [siyuanSearch(t), EditorState.readOnly.of(readOnly)],
        }),
    });
    views.push(view);
    return view;
}

const panel = (view: EditorView): HTMLElement | null =>
    view.dom.querySelector<HTMLElement>(".editor-siyuan-search");

const searchField = (view: EditorView): HTMLInputElement =>
    panel(view)!.querySelector<HTMLInputElement>('[main-field="true"]')!;

const replaceField = (view: EditorView): HTMLInputElement =>
    panel(view)!.querySelector<HTMLInputElement>('[data-type="replaceText"]')!;

const replaceRow = (view: EditorView): HTMLElement =>
    panel(view)!.querySelector<HTMLElement>(".editor-siyuan-search__replace")!;

function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input"));
}

afterEach(() => {
    for (const view of views.splice(0)) {
        view.destroy();
    }
});

describe("面板开关", () => {
    it("toggle 打开面板，再 toggle 收起并把焦点交回正文", () => {
        const view = makeEditor();
        const focus = vi.spyOn(view, "focus");
        expect(toggleSearchPanel(view)).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(true);
        expect(panel(view)).not.toBeNull();

        expect(toggleSearchPanel(view)).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(false);
        expect(panel(view)).toBeNull();
        expect(focus).toHaveBeenCalled();
    });

    it("closeSearch 在面板未打开时什么也不做", () => {
        const view = makeEditor();
        const focus = vi.spyOn(view, "focus");
        expect(closeSearch(view)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it("closeSearch 收起已打开的面板并聚焦正文", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const focus = vi.spyOn(view, "focus");
        expect(closeSearch(view)).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(false);
        expect(focus).toHaveBeenCalled();
    });

    it("Ctrl+F 经键位表打开，再按一次收起", () => {
        const parent = document.createElement("div");
        document.body.append(parent);
        const view = createEditor(parent, {
            doc: "foo",
            language: "plaintext",
            readOnly: false,
            showLineNumbers: false,
            lineWrap: false,
            ligatures: false,
            autocomplete: false,
            drawSelection: true,
            tabSpaces: 4,
            t,
            onChange: () => undefined,
        });
        views.push(view);
        view.focus();

        const first = new KeyboardEvent("keydown", {
            key: "f",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        view.contentDOM.dispatchEvent(first);
        expect(searchPanelOpen(view.state)).toBe(true);

        const second = new KeyboardEvent("keydown", {
            key: "f",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        view.contentDOM.dispatchEvent(second);
        expect(searchPanelOpen(view.state)).toBe(false);
    });
});

describe("面板结构", () => {
    it("查找框带 main-field 标记与 i18n 占位符", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const field = searchField(view);
        expect(field.getAttribute("main-field")).toBe("true");
        expect(field.placeholder).toBe("查找");
        expect(field.getAttribute("aria-label")).toBe("查找");
        expect(field.autocomplete).toBe("off");
        expect(field.getAttribute("spellcheck")).toBe("false");
    });

    it("替换框与三个开关、五个图标按钮齐全", () => {
        const view = makeEditor();
        openSearchPanel(view);
        expect(replaceField(view).placeholder).toBe("替换为");
        for (const type of ["caseSensitive", "wholeWord", "regexp", "prev", "next", "close"]) {
            expect(panel(view)!.querySelector(`[data-type="${type}"]`), type).not.toBeNull();
        }
        expect(panel(view)!.querySelectorAll(".editor-siyuan-search__row")).toHaveLength(2);
        expect(panel(view)!.querySelectorAll("button.b3-button")).toHaveLength(2);
    });

    it("图标按钮带 aria-label，开关初始未激活", () => {
        const view = makeEditor();
        openSearchPanel(view);
        expect(panel(view)!.querySelector('[data-type="caseSensitive"]')!.getAttribute("aria-label"))
            .toBe("区分大小写");
        expect(panel(view)!.querySelector('[data-type="next"]')!.getAttribute("aria-label")).toBe("下一个");
        expect(panel(view)!.querySelector('[data-type="caseSensitive"] svg')!.classList.contains("ft__primary"))
            .toBe(false);
    });

    it("打开时选中已有查询内容，直接输入即替换", () => {
        const view = makeEditor();
        view.dispatch({effects: setSearchQuery.of(new SearchQuery({search: "foo"}))});
        openSearchPanel(view);
        const field = searchField(view);
        expect(field.value).toBe("foo");
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe(3);
    });

    it("只读时整行替换控件隐藏，切回编辑后恢复", () => {
        const readOnly = new Compartment();
        const parent = document.createElement("div");
        document.body.append(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: "foo foo",
                extensions: [siyuanSearch(t), readOnly.of(EditorState.readOnly.of(true))],
            }),
        });
        views.push(view);
        openSearchPanel(view);
        expect(replaceRow(view).classList.contains("fn__none")).toBe(true);
        // 替换框与两个按钮都在这一行里，跟着一起藏起来
        expect(replaceField(view).closest(".editor-siyuan-search__replace")).toBe(replaceRow(view));

        view.dispatch({effects: readOnly.reconfigure(EditorState.readOnly.of(false))});
        expect(replaceRow(view).classList.contains("fn__none")).toBe(false);

        view.dispatch({effects: readOnly.reconfigure(EditorState.readOnly.of(true))});
        expect(replaceRow(view).classList.contains("fn__none")).toBe(true);
    });
});

describe("查询提交", () => {
    it("查找框输入后派发新查询", () => {
        const view = makeEditor();
        openSearchPanel(view);
        type(searchField(view), "bar");
        expect(getSearchQuery(view.state).search).toBe("bar");
    });

    it("替换框输入后派发新查询", () => {
        const view = makeEditor();
        openSearchPanel(view);
        type(replaceField(view), "baz");
        expect(getSearchQuery(view.state).replace).toBe("baz");
    });

    it("三个开关写进查询并切换激活态", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const click = (type: string) => panel(view)!.querySelector<HTMLElement>(`[data-type="${type}"]`)!.click();

        click("caseSensitive");
        expect(getSearchQuery(view.state).caseSensitive).toBe(true);
        expect(panel(view)!.querySelector('[data-type="caseSensitive"] svg')!.classList.contains("ft__primary"))
            .toBe(true);

        click("wholeWord");
        expect(getSearchQuery(view.state).wholeWord).toBe(true);

        click("regexp");
        expect(getSearchQuery(view.state).regexp).toBe(true);

        click("caseSensitive");
        expect(getSearchQuery(view.state).caseSensitive).toBe(false);
        expect(panel(view)!.querySelector('[data-type="caseSensitive"] svg')!.classList.contains("ft__primary"))
            .toBe(false);
    });

    it("外部派发查询时同步输入框与开关", () => {
        const view = makeEditor();
        openSearchPanel(view);
        view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({
                search: "outside",
                replace: "inside",
                caseSensitive: true,
                wholeWord: true,
                regexp: true,
            })),
        });
        expect(searchField(view).value).toBe("outside");
        expect(replaceField(view).value).toBe("inside");
        for (const type of ["caseSensitive", "wholeWord", "regexp"]) {
            expect(panel(view)!.querySelector(`[data-type="${type}"] svg`)!.classList.contains("ft__primary"), type)
                .toBe(true);
        }
    });

    it("外部派发相同的查询时不重复同步", () => {
        const view = makeEditor();
        openSearchPanel(view);
        type(searchField(view), "x");
        const current = getSearchQuery(view.state);
        searchField(view).value = "stale";
        view.dispatch({effects: setSearchQuery.of(current)});
        expect(searchField(view).value).toBe("stale");
    });
});

describe("键盘", () => {
    it("Esc 关闭面板", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        searchField(view).dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(false);
    });

    it("面板里的 Ctrl+F 只关面板，不再触发宿主搜索", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const event = new KeyboardEvent("keydown", {
            key: "F",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        searchField(view).dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(false);
    });

    it("回车查找下一个，Shift+回车查找上一个", () => {
        const view = makeEditor("foo foo foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        view.dispatch({selection: {anchor: 0}});

        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
        expect(view.state.selection.main.from).toBe(0);
        expect(view.state.selection.main.to).toBe(3);

        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
        expect(view.state.selection.main.from).toBe(4);
        expect(view.state.selection.main.to).toBe(7);

        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }));
        expect(view.state.selection.main.from).toBe(0);
    });

    it("在替换框里回车执行替换", () => {
        const view = makeEditor("foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 0}});
        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
        replaceField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
        expect(view.state.doc.toString()).toBe("bar");
    });

    it("面板里的按键不再冒泡到思源全局快捷键", () => {
        const view = makeEditor();
        openSearchPanel(view);
        const later = vi.fn();
        document.addEventListener("keydown", later);
        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "a",
            bubbles: true,
            cancelable: true,
        }));
        expect(later).not.toHaveBeenCalled();
    });
});

describe("按钮", () => {
    it("上一个 / 下一个移动选区", () => {
        const view = makeEditor("foo foo foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        view.dispatch({selection: {anchor: 0}});

        panel(view)!.querySelector<HTMLElement>('[data-type="next"]')!.click();
        expect(view.state.selection.main.from).toBe(0);
        panel(view)!.querySelector<HTMLElement>('[data-type="next"]')!.click();
        expect(view.state.selection.main.from).toBe(4);
        panel(view)!.querySelector<HTMLElement>('[data-type="prev"]')!.click();
        expect(view.state.selection.main.from).toBe(0);
    });

    it("关闭按钮收起面板", () => {
        const view = makeEditor();
        openSearchPanel(view);
        panel(view)!.querySelector<HTMLElement>('[data-type="close"]')!.click();
        expect(searchPanelOpen(view.state)).toBe(false);
    });

    it("替换按钮替换当前命中", () => {
        const view = makeEditor("foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 0}});
        searchField(view).dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
        panel(view)!.querySelector<HTMLElement>('button[data-type="replace"]')!.click();
        expect(view.state.doc.toString()).toBe("bar");
    });

    it("选区不在命中上时，点一次替换就替换视口里的第一条", () => {
        const view = makeEditor("foo x foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        // 光标停在末尾，不在任何命中上；旧实现会先「选中一条」再要求点第二次
        view.dispatch({selection: {anchor: 9}});
        panel(view)!.querySelector<HTMLElement>('button[data-type="replace"]')!.click();
        expect(view.state.doc.toString()).toBe("bar x foo");
        // 替换后选区落到下一条命中，下一次点击接着替换它
        expect(view.state.selection.main.from).toBe(6);
        expect(view.state.selection.main.to).toBe(9);
    });

    it("连续点击替换依次替换每一处", () => {
        const view = makeEditor("foo foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 7}});
        const replace = panel(view)!.querySelector<HTMLElement>('button[data-type="replace"]')!;
        replace.click();
        expect(view.state.doc.toString()).toBe("bar foo");
        replace.click();
        expect(view.state.doc.toString()).toBe("bar bar");
    });

    it("选区正好压着某条命中时替换那一条", () => {
        const view = makeEditor("foo foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 4, head: 7}});
        panel(view)!.querySelector<HTMLElement>('button[data-type="replace"]')!.click();
        expect(view.state.doc.toString()).toBe("foo bar");
    });

    it("只读时替换不动文档", () => {
        const view = makeEditor("foo foo", true);
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 0, head: 3}});
        panel(view)!.querySelector<HTMLElement>('button[data-type="replace"]')!.click();
        expect(view.state.doc.toString()).toBe("foo foo");
    });

    it("点替换输入框本身不会替换", () => {
        const view = makeEditor("foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        view.dispatch({selection: {anchor: 0}});
        replaceField(view).click();
        expect(view.state.doc.toString()).toBe("foo");
    });

    it("全部替换按钮替换所有命中", () => {
        const view = makeEditor("foo foo");
        openSearchPanel(view);
        type(searchField(view), "foo");
        type(replaceField(view), "bar");
        panel(view)!.querySelector<HTMLElement>('button[data-type="replaceAll"]')!.click();
        expect(view.state.doc.toString()).toBe("bar bar");
    });
});
