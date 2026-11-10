import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState} from "@codemirror/state";
import {history, redoDepth, undo, undoDepth} from "@codemirror/commands";
import {openSearchPanel} from "@codemirror/search";
import type {EditorView} from "@codemirror/view";
import {Menu, showMessage, __setFrontend} from "../support/siyuan";
import {installConfig} from "../support/env";
import {makeT} from "../../src/i18n";
import {openEditorMenu} from "../../src/menus/context-menu";

vi.mock("@codemirror/search", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@codemirror/search")>()),
    openSearchPanel: vi.fn(),
}));

const t = makeT({
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    undo: "撤销",
    redo: "重做",
    find: "查找",
    save: "保存",
    pasteFailed: "无法粘贴",
});

interface IFakeView {
    view: EditorView;
    state: () => EditorState;
}

function makeView(options: {doc?: string; selected?: boolean; change?: boolean} = {}): IFakeView {
    let state = EditorState.create({doc: options.doc ?? "abc", extensions: [history()]});
    if (options.change) {
        state = state.update({changes: {from: state.doc.length, insert: "d"}}).state;
    }
    if (options.selected) {
        state = state.update({selection: {anchor: 0, head: 2}}).state;
    }
    const view: any = {
        state,
        dispatch: vi.fn((spec: any) => {
            state = spec?.state ?? state.update(spec).state;
            view.state = state;
        }),
        focus: vi.fn(),
    };
    return {view, state: () => view.state};
}

function redoableView(): IFakeView {
    let state = EditorState.create({doc: "a", extensions: [history()]});
    state = state.update({changes: {from: 1, insert: "b"}}).state;
    undo({state, dispatch: (transaction) => {
        state = transaction.state;
    }});
    const view: any = {
        state,
        dispatch: vi.fn((spec: any) => {
            state = spec?.state ?? state.update(spec).state;
            view.state = state;
        }),
        focus: vi.fn(),
    };
    return {view, state: () => view.state};
}

const lastMenu = (): Menu => Menu.instances[Menu.instances.length - 1];
const ids = (): Array<string | undefined> => lastMenu().items.map((item) => item.id);
const item = (id: string) => lastMenu().items.find((entry) => entry.id === id)!;

afterEach(() => {
    delete (navigator as any).clipboard;
});

describe("openEditorMenu", () => {
    it("有选区且可编辑时提供完整的编辑菜单", () => {
        const {view} = makeView({selected: true});
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 3, 4);
        expect(ids()).toEqual(["cut", "copy", "paste", "selectAll", "undo", "redo", "find", "save"]);
        expect(lastMenu().element.querySelectorAll(".b3-menu__separator")).toHaveLength(3);
        expect(lastMenu().openOptions).toEqual({x: 3, y: 4});
    });

    it("没有选区时不给剪切与复制", () => {
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(ids()).toEqual(["paste", "selectAll", "undo", "redo", "find", "save"]);
    });

    it("只读时保留复制与全选，去掉剪切与粘贴", () => {
        const {view} = makeView({selected: true});
        openEditorMenu({view, t, readOnly: true, onSave: vi.fn()}, 0, 0);
        expect(ids()).toEqual(["copy", "selectAll", "undo", "redo", "find", "save"]);
        expect(item("copy").disabled).toBeUndefined();
        expect(item("undo").disabled).toBe(true);
        expect(item("redo").disabled).toBe(true);
        expect(item("save").disabled).toBe(true);
    });

    it("撤销栈为空时撤销置灰，有改动后可用", () => {
        const {view} = makeView({change: true});
        expect(undoDepth(view.state)).toBe(1);
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("undo").disabled).toBe(false);
        expect(item("redo").disabled).toBe(true);
    });

    it("撤销之后重做可用", () => {
        const {view} = redoableView();
        expect(redoDepth(view.state)).toBe(1);
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("redo").disabled).toBe(false);
    });

    it("重做快捷键按平台切换", () => {
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("redo").accelerator).toBe("⌘Y");

        installConfig({system: {os: "darwin"}});
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("redo").accelerator).toBe("⇧⌘Z");
    });

    it("图标与快捷键对齐思源自己的编辑器菜单", () => {
        const {view} = makeView({selected: true});
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("cut")).toMatchObject({icon: "iconCut", accelerator: "⌘X"});
        expect(item("copy")).toMatchObject({icon: "iconCopy", accelerator: "⌘C"});
        expect(item("paste")).toMatchObject({icon: "iconPaste", accelerator: "⌘V"});
        expect(item("selectAll")).toMatchObject({icon: "iconSelectAll", accelerator: "⌘A"});
        expect(item("undo")).toMatchObject({icon: "iconUndo", accelerator: "⌘Z"});
        expect(item("find")).toMatchObject({icon: "iconSearch", accelerator: "⌘F"});
        expect(item("save")).toMatchObject({accelerator: "⌘S"});
    });

    it("剪切与复制先聚焦编辑器，再走 execCommand", () => {
        const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);
        const {view} = makeView({selected: true});
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("cut").click!();
        expect(view.focus).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith("cut");
        item("copy").click!();
        expect(view.focus).toHaveBeenCalledTimes(2);
        expect(exec).toHaveBeenCalledWith("copy");
    });

    it("粘贴优先使用 execCommand", () => {
        const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);
        const readText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {value: {readText}, configurable: true});
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("paste").click!();
        expect(exec).toHaveBeenCalledWith("paste");
        expect(readText).not.toHaveBeenCalled();
    });

    it("execCommand 不可用时退回异步剪贴板", async () => {
        vi.spyOn(document, "execCommand").mockReturnValue(false);
        const readText = vi.fn().mockResolvedValue("pasted");
        Object.defineProperty(navigator, "clipboard", {value: {readText}, configurable: true});
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("paste").click!();
        await vi.waitFor(() => expect(view.dispatch).toHaveBeenCalledTimes(1));
        expect(view.state.doc.toString()).toBe("pastedabc");
    });

    it("异步剪贴板失败时提示", async () => {
        vi.spyOn(document, "execCommand").mockReturnValue(false);
        const readText = vi.fn().mockRejectedValue(new Error("denied"));
        Object.defineProperty(navigator, "clipboard", {value: {readText}, configurable: true});
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("paste").click!();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("无法粘贴", 3000, "error");
    });

    it("两条粘贴路径都不可用时置灰", () => {
        __setFrontend("browser-desktop");
        vi.spyOn(document, "execCommand").mockReturnValue(false);
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("paste").disabled).toBe(true);
    });

    it("浏览器里有异步剪贴板时粘贴可用", () => {
        __setFrontend("browser-desktop");
        Object.defineProperty(navigator, "clipboard", {value: {readText: vi.fn()}, configurable: true});
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        expect(item("paste").disabled).toBe(false);
    });

    it("全选先聚焦，再派发选区", () => {
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("selectAll").click!();
        expect(view.focus).toHaveBeenCalledTimes(1);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
        const selection = (view.dispatch as any).mock.calls[0][0].selection;
        expect(selection.main.from).toBe(0);
        expect(selection.main.to).toBe(3);
    });

    it("查找项打开 CodeMirror 的搜索面板", () => {
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("find").click!();
        expect(openSearchPanel).toHaveBeenCalledWith(view);
    });

    it("保存项调用传入的回调", () => {
        const onSave = vi.fn();
        const {view} = makeView();
        openEditorMenu({view, t, readOnly: false, onSave}, 0, 0);
        item("save").click!();
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("撤销与重做先聚焦再执行", () => {
        const {view} = makeView({change: true});
        openEditorMenu({view, t, readOnly: false, onSave: vi.fn()}, 0, 0);
        item("undo").click!();
        expect(view.focus).toHaveBeenCalledTimes(1);
        expect(view.dispatch).toHaveBeenCalledTimes(1);
    });
});
