import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {indentUnit} from "@codemirror/language";
import {installHljs} from "../support/env";
import {makeT} from "../../src/i18n";
import {
    createEditor,
    readCursor,
    restoreCursor,
    setEditorLanguage,
    setEditorLigatures,
    setEditorLineNumbers,
    setEditorLineWrap,
    setEditorReadOnly,
} from "../../src/editor";

const t = makeT({});
const views: EditorView[] = [];

interface IOptions {
    doc?: string;
    language?: string;
    readOnly?: boolean;
    showLineNumbers?: boolean;
    lineWrap?: boolean;
    ligatures?: boolean;
    tabSpaces?: number;
    onContextMenu?: (event: MouseEvent) => void;
    onChange?: () => void;
}

function make(options: IOptions = {}): {view: EditorView; parent: HTMLElement; onChange: ReturnType<typeof vi.fn>} {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onChange = vi.fn(options.onChange);
    const view = createEditor(parent, {
        doc: options.doc ?? "const a = 1;",
        language: options.language ?? "javascript",
        readOnly: options.readOnly ?? false,
        showLineNumbers: options.showLineNumbers ?? false,
        lineWrap: options.lineWrap ?? false,
        ligatures: options.ligatures ?? false,
        tabSpaces: options.tabSpaces ?? 4,
        t,
        onContextMenu: options.onContextMenu,
        onChange,
    });
    views.push(view);
    return {view, parent, onChange};
}

afterEach(() => {
    for (const view of views.splice(0)) {
        view.destroy();
    }
    vi.useRealTimers();
});

describe("createEditor", () => {
    it("建立编辑器并挂到传入的容器里", () => {
        installHljs();
        const {view, parent} = make();
        expect(view.state.doc.toString()).toBe("const a = 1;");
        expect(view.dom.classList.contains("cm-editor")).toBe(true);
        expect(parent.contains(view.dom)).toBe(true);
        expect(view.state.readOnly).toBe(false);
    });

    it("初始语言交给 hljs，未知语言退回纯文本", () => {
        const {calls} = installHljs({languages: ["plaintext"]});
        make({language: "python"});
        expect(calls[0]).toMatchObject({code: "const a = 1;", language: "plaintext", ignoreIllegals: true});
    });

    it("优先用 hljs 的 token 树生成装饰", () => {
        installHljs({
            languages: ["javascript", "plaintext"],
            highlight: () => ({
                value: "<span class=\"hljs-keyword\">const</span> a = 1;",
                _emitter: {rootNode: {children: [{scope: "keyword", children: ["const"]}, " a = 1;"]}},
            }),
        });
        const {view} = make();
        const keyword = view.dom.querySelector(".hljs-keyword");
        expect(keyword).not.toBeNull();
        expect(keyword!.textContent).toBe("const");
    });

    it("多级 scope 展开成复合类名", () => {
        installHljs({
            languages: ["javascript", "plaintext"],
            highlight: () => ({
                value: "",
                _emitter: {
                    rootNode: {
                        children: [
                            {scope: "title.function", children: ["f"]},
                            "()",
                        ],
                    },
                },
            }),
        });
        const {view} = make({doc: "f()"});
        const element = view.dom.querySelector(".hljs-title.function_");
        expect(element).not.toBeNull();
        expect(element!.textContent).toBe("f");
    });

    it("language: 前缀转成 language- 类名", () => {
        installHljs({
            languages: ["javascript", "plaintext"],
            highlight: () => ({
                value: "",
                _emitter: {rootNode: {children: [{scope: "language:js", children: ["x"]}, "y"]}},
            }),
        });
        const {view} = make({doc: "xy"});
        expect(view.dom.querySelector(".language-js")).not.toBeNull();
    });

    it("没有 token 树时退回解析 hljs 的 HTML", () => {
        installHljs({
            languages: ["javascript", "plaintext"],
            highlight: () => ({
                value: "<span class=\"hljs-title function_\">f</span>()",
            }),
        });
        const {view} = make({doc: "f()"});
        const element = view.dom.querySelector(".hljs-title.function_");
        expect(element).not.toBeNull();
        expect(element!.textContent).toBe("f");
    });

    it("引擎缺失时编辑器仍可建立，只是没有装饰", () => {
        const {view} = make();
        expect(view.dom.querySelector(".hljs-keyword")).toBeNull();
        expect(view.state.doc.toString()).toBe("const a = 1;");
    });

    it("正文变化时同步重算高亮", () => {
        const {calls} = installHljs({languages: ["javascript", "plaintext"]});
        const {view} = make();
        view.dispatch({changes: {from: view.state.doc.length, insert: "x"}});
        expect(calls.map((call) => call.code)).toContain("const a = 1;x");
    });

    it("换语言时立即重算，同一语言不重复计算", () => {
        const {calls} = installHljs({languages: ["javascript", "typescript", "plaintext"]});
        const {view} = make();
        expect(calls).toHaveLength(1);
        setEditorLanguage(view, "typescript");
        expect(calls).toHaveLength(2);
        expect(calls[1].language).toBe("typescript");
        setEditorLanguage(view, "typescript");
        expect(calls).toHaveLength(2);
    });

    it("换语言不会改动文档", () => {
        installHljs({languages: ["javascript", "typescript", "plaintext"]});
        const {view} = make();
        setEditorLanguage(view, "typescript");
        expect(view.state.doc.toString()).toBe("const a = 1;");
    });

    it("初始 Tab 宽度与缩进单位跟随 tabSpaces", () => {
        installHljs();
        const four = make({tabSpaces: 4}).view;
        expect(four.state.facet(EditorState.tabSize)).toBe(4);
        expect(four.state.facet(indentUnit)).toBe("    ");

        const tab = make({tabSpaces: 0}).view;
        expect(tab.state.facet(EditorState.tabSize)).toBe(4);
        expect(tab.state.facet(indentUnit)).toBe("\t");

        const two = make({tabSpaces: 2}).view;
        expect(two.state.facet(EditorState.tabSize)).toBe(2);
        expect(two.state.facet(indentUnit)).toBe("  ");
    });
});

describe("编辑器开关", () => {
    it("只读开关只切 readOnly，正文仍保留 contenteditable", () => {
        installHljs();
        const {view} = make();
        setEditorReadOnly(view, true);
        expect(view.state.readOnly).toBe(true);
        // editable 不能跟着关：关掉它 .cm-content 就没有 contenteditable，
        // 焦点、⌘A 与移动端的光标会一起失效（issue #23 / #24）
        expect(view.state.facet(EditorView.editable)).toBe(true);
        expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
        setEditorReadOnly(view, false);
        expect(view.state.readOnly).toBe(false);
        expect(view.state.facet(EditorView.editable)).toBe(true);
    });

    it("行号开关切换 gutter", () => {
        installHljs();
        const {view} = make();
        expect(view.dom.querySelector(".cm-lineNumbers")).toBeNull();
        setEditorLineNumbers(view, true);
        expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
        setEditorLineNumbers(view, false);
        expect(view.dom.querySelector(".cm-lineNumbers")).toBeNull();
    });

    it("换行开关切换 lineWrapping facet", () => {
        installHljs();
        const {view} = make();
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
        setEditorLineWrap(view, true);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
        setEditorLineWrap(view, false);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    });

    it("连字开关写内联样式", () => {
        installHljs();
        const {view} = make({ligatures: false});
        expect(view.dom.style.fontVariantLigatures).toBe("none");
        setEditorLigatures(view, true);
        expect(view.dom.style.fontVariantLigatures).toBe("normal");
        setEditorLigatures(view, false);
        expect(view.dom.style.fontVariantLigatures).toBe("none");
    });
});

describe("光标", () => {
    it("读取选区 anchor 与滚动位置", () => {
        installHljs();
        const {view} = make();
        view.dispatch({selection: {anchor: 3}});
        view.scrollDOM.scrollTop = 42;
        expect(readCursor(view)).toEqual({anchor: 3, scrollTop: 42});
    });

    it("恢复时把越界的 anchor 夹到文档长度", () => {
        installHljs();
        const {view} = make({doc: "abc"});
        restoreCursor(view, {anchor: 999, scrollTop: 7});
        expect(view.state.selection.main.anchor).toBe(3);
        expect(view.scrollDOM.scrollTop).toBe(7);
    });
});

describe("事件", () => {
    it("文档变化触发 onChange，选区变化不触发", () => {
        installHljs();
        const {view, onChange} = make();
        view.dispatch({selection: {anchor: 2}});
        expect(onChange).not.toHaveBeenCalled();
        view.dispatch({changes: {from: 0, insert: "x"}});
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("右键拦截并交给插件菜单", () => {
        installHljs();
        const onContextMenu = vi.fn();
        const {view} = make({onContextMenu});
        const event = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        view.contentDOM.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("没有传 onContextMenu 时放行原生菜单", () => {
        installHljs();
        const {view} = make();
        const event = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        view.contentDOM.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it("搜索面板里的右键不拦，留给宿主", () => {
        installHljs();
        const onContextMenu = vi.fn();
        const {view} = make({onContextMenu});
        const panel = document.createElement("div");
        panel.className = "editor-siyuan-search";
        const child = document.createElement("input");
        panel.append(child);
        view.dom.append(panel);
        const event = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        child.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(onContextMenu).not.toHaveBeenCalled();
    });

    it("已被 CodeMirror 处理的按键不再冒泡", () => {
        installHljs();
        const {view} = make();
        const later = vi.fn();
        document.addEventListener("keydown", later);

        const handled = new KeyboardEvent("keydown", {key: "F13", bubbles: true, cancelable: true});
        handled.preventDefault();
        view.contentDOM.dispatchEvent(handled);
        expect(later).not.toHaveBeenCalled();

        const plain = new KeyboardEvent("keydown", {key: "F13", bubbles: true, cancelable: true});
        view.contentDOM.dispatchEvent(plain);
        expect(later).toHaveBeenCalledTimes(1);
    });
});

describe("高亮耗时超出同步预算时退回防抖", () => {
    it("先映射旧装饰，停止输入后补算", async () => {
        const {calls} = installHljs({
            languages: ["javascript", "plaintext"],
            highlight: (code) => ({
                value: code,
                _emitter: {rootNode: {children: [code]}},
            }),
        });
        let tick = 0;
        const now = vi.spyOn(performance, "now").mockImplementation(() => {
            tick += 10;
            return tick;
        });
        const {view} = make();
        expect(calls).toHaveLength(1);
        now.mockRestore();

        view.dispatch({changes: {from: view.state.doc.length, insert: "x"}});
        expect(calls).toHaveLength(1);

        await new Promise((resolve) => setTimeout(resolve, 320));
        expect(calls).toHaveLength(2);
        expect(calls[1].code).toBe("const a = 1;x");
    });

    it("耗时在预算内时继续同步重算，不排定时器", async () => {
        const {calls} = installHljs({
            languages: ["javascript", "plaintext"],
            highlight: (code) => ({value: code, _emitter: {rootNode: {children: [code]}}}),
        });
        const {view} = make();
        view.dispatch({changes: {from: view.state.doc.length, insert: "x"}});
        expect(calls).toHaveLength(2);
        await new Promise((resolve) => setTimeout(resolve, 320));
        expect(calls).toHaveLength(2);
    });
});
