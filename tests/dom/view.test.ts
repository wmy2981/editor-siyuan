import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {EditorState} from "@codemirror/state";
import {Plugin, showMessage, __setFrontend} from "../support/siyuan";
import {installConfig, makeSettings} from "../support/env";
import {
    initStore,
    putStash,
    rememberedCursor,
    rememberedLanguage,
    rememberCursor,
    rememberLanguage,
    stashedEntry,
} from "../../src/config";
import {makeT} from "../../src/i18n";
import {openConfirmDialog} from "../../src/dialog";
import {openLanguageMenu} from "../../src/language-menu";
import {openMoreMenu} from "../../src/more-menu";
import {openEditorMenu} from "../../src/context-menu";
import {toggleSearchPanel, closeSearch} from "../../src/search";
import {loadHljs} from "../../src/hljs";
import {
    applyRedo,
    applyUndo,
    canRedo,
    canUndo,
    createEditor,
    readCursor,
    restoreCursor,
    setEditorLanguage,
    setEditorLigatures,
    setEditorLineNumbers,
    setEditorLineWrap,
    setEditorReadOnly,
} from "../../src/editor";
import {
    allTabs,
    createView,
    focusedTab,
    refreshEditorSettings,
    tabFor,
    watchEditorConfig,
    type IEditorTab,
    type IViewHost,
} from "../../src/view";
import {
    readAssetText,
    resolveAsset,
    resolveWorkspaceFile,
    writeAssetText,
} from "../../src/asset";

vi.mock("../../src/asset", () => ({
    readAssetText: vi.fn(),
    resolveAsset: vi.fn(),
    resolveWorkspaceFile: vi.fn(),
    writeAssetText: vi.fn(),
}));
vi.mock("../../src/editor", () => ({
    applyRedo: vi.fn(),
    applyUndo: vi.fn(),
    canRedo: vi.fn(),
    canUndo: vi.fn(),
    createEditor: vi.fn(),
    readCursor: vi.fn(),
    restoreCursor: vi.fn(),
    setEditorLanguage: vi.fn(),
    setEditorLigatures: vi.fn(),
    setEditorLineNumbers: vi.fn(),
    setEditorLineWrap: vi.fn(),
    setEditorReadOnly: vi.fn(),
}));
vi.mock("../../src/hljs", () => ({loadHljs: vi.fn()}));
vi.mock("../../src/dialog", () => ({openConfirmDialog: vi.fn()}));
vi.mock("../../src/search", () => ({toggleSearchPanel: vi.fn(), closeSearch: vi.fn()}));
vi.mock("../../src/language-menu", () => ({openLanguageMenu: vi.fn()}));
vi.mock("../../src/more-menu", () => ({openMoreMenu: vi.fn()}));
vi.mock("../../src/context-menu", () => ({openEditorMenu: vi.fn()}));

const t = makeT({
    loading: "加载中…",
    workspaceReadonly: "工作区只读",
    openFailed: "打开失败: {message}",
    tooLarge: "文件过大（{size}，上限 {limit} MB）",
    saved: "已保存",
    save: "保存",
    saveDirty: "保存（有改动）",
    saveFailed: "保存失败",
    readonlyEditor: "只读模式不能保存",
    syReadonly: "文档预览不能保存",
    close: "关闭",
    find: "查找",
    switchToEdit: "切到编辑",
    switchToPreview: "切到预览",
    more: "更多",
    undo: "撤销",
    redo: "重做",
    lineWrap: "换行",
    languageLabel: "语言",
    restoreTitle: "恢复未保存内容",
    restoreBody: "上次关闭时有未保存内容",
    restoreIgnore: "忽略",
    restoreDiscard: "丢弃",
    restoreAccept: "恢复",
});

const REF = {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 10};
const SY_REF = {link: "/data/box/a.sy", apiPath: "/data/box/a.sy", size: 10};

let settings = makeSettings();
let lastOptions: any;
let editor: any;
let plugin: Plugin;

function fakeEditor(doc: string): any {
    return {
        state: EditorState.create({doc}),
        dispatch: vi.fn(),
        destroy: vi.fn(),
        focus: vi.fn(),
        scrollDOM: {scrollTop: 0},
    };
}

function host(data: Record<string, unknown> = {link: REF.link}, extra: Partial<IViewHost> = {}): IViewHost {
    const element = document.createElement("div");
    document.body.append(element);
    return {element, data, ...extra};
}

function openView(viewHost: IViewHost = host()): IEditorTab {
    return createView(viewHost, t, () => settings);
}

async function openReady(viewHost: IViewHost = host()): Promise<IEditorTab> {
    const tab = openView(viewHost);
    await vi.waitFor(() => expect(createEditor).toHaveBeenCalled());
    return tab;
}

const saveIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="save"]')!;
const readonlyIcon = (tab: IEditorTab): HTMLElement =>
    tab.element.querySelector<HTMLElement>('[data-type="readonly"]')!;
const searchIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="search"]')!;
const moreIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="more"]')!;
const undoIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="undo"]')!;
const redoIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="redo"]')!;
const wrapIcon = (tab: IEditorTab): HTMLElement => tab.element.querySelector<HTMLElement>('[data-type="wrap"]')!;
const languageLabel = (tab: IEditorTab): HTMLElement =>
    tab.element.querySelector<HTMLElement>(".editor-siyuan__language")!;

beforeEach(async () => {
    plugin = new Plugin();
    await initStore(plugin as unknown as SiyuanPlugin);
    settings = makeSettings();
    vi.mocked(resolveAsset).mockResolvedValue({kind: "ok", ref: REF});
    vi.mocked(resolveWorkspaceFile).mockResolvedValue({kind: "ok", ref: SY_REF});
    vi.mocked(readAssetText).mockResolvedValue({text: "hello", eol: "\n", bom: false});
    vi.mocked(writeAssetText).mockResolvedValue(undefined);
    vi.mocked(loadHljs).mockResolvedValue(true);
    vi.mocked(readCursor).mockReturnValue({anchor: 3, scrollTop: 4});
    vi.mocked(canUndo).mockReturnValue(false);
    vi.mocked(canRedo).mockReturnValue(false);
    vi.mocked(createEditor).mockImplementation((_parent, options) => {
        lastOptions = options;
        editor = fakeEditor(options.doc);
        return editor;
    });
});

afterEach(() => {
    for (const tab of allTabs()) {
        tab.dispose();
    }
});

describe("初始渲染", () => {
    it("先显示加载占位符，并挂到宿主容器里", () => {
        const viewHost = host();
        const tab = openView(viewHost);
        expect(tab.element.classList.contains("editor-siyuan")).toBe(true);
        expect(viewHost.element.contains(tab.element)).toBe(true);
        expect(tab.element.querySelector(".editor-siyuan__placeholder")?.textContent).toBe("加载中…");
        expect(tab.isDirty()).toBe(false);
    });

    it("桌面端没有关闭按钮与标题栏", () => {
        const tab = openView();
        expect(tab.element.querySelector('[data-type="close"]')).toBeNull();
        expect(tab.element.querySelector(".editor-siyuan__title")).toBeNull();
    });

    it("移动端显示关闭按钮与文件名", () => {
        const tab = openView(host({link: REF.link}, {title: "a.txt", onClose: vi.fn()}));
        expect(tab.element.querySelector('[data-type="close"]')).not.toBeNull();
        expect(tab.element.querySelector(".editor-siyuan__title")?.textContent).toBe("a.txt");
    });

    it("只给标题时只显示文件名，不出关闭按钮", () => {
        const tab = openView(host({link: REF.link}, {title: "a.txt"}));
        expect(tab.element.querySelector('[data-type="close"]')).toBeNull();
        expect(tab.element.querySelector(".editor-siyuan__title")?.textContent).toBe("a.txt");
    });

    it("浮动窗口里同样显示文件名", () => {
        __setFrontend("desktop-window");
        const tab = openView(host({link: REF.link}, {title: "a.txt"}));
        expect(tab.element.querySelector('[data-type="close"]')).toBeNull();
        expect(tab.element.querySelector(".editor-siyuan__title")?.textContent).toBe("a.txt");
    });

    it("操作条按钮都带 aria-label", () => {
        const tab = openView();
        expect(saveIcon(tab).getAttribute("aria-label")).toBe("保存");
        expect(searchIcon(tab).getAttribute("aria-label")).toBe("查找");
        expect(readonlyIcon(tab).getAttribute("aria-label")).toBe("切到预览");
        expect(moreIcon(tab).getAttribute("aria-label")).toBe("更多");
        expect(languageLabel(tab).getAttribute("aria-label")).toBe("语言");
    });

    it(".sy 预览隐藏只读与保存入口", () => {
        const tab = openView(host({link: SY_REF.link, sy: true}));
        expect(readonlyIcon(tab).classList.contains("fn__none")).toBe(true);
        expect(saveIcon(tab).classList.contains("fn__none")).toBe(true);
    });
});

describe("加载文件", () => {
    it("成功时建立编辑器并传入全部选项", async () => {
        settings = makeSettings({lineNumbers: "show", lineWrap: "on", ligatures: "on", openMode: "edit"});
        installConfig({editor: {codeTabSpaces: 2}});
        const tab = await openReady();
        expect(resolveAsset).toHaveBeenCalledWith(REF.link);
        expect(readAssetText).toHaveBeenCalledWith(REF);
        expect(loadHljs).toHaveBeenCalled();
        expect(lastOptions).toMatchObject({
            doc: "hello",
            language: "plaintext",
            readOnly: false,
            showLineNumbers: true,
            lineWrap: true,
            ligatures: true,
            tabSpaces: 2,
        });
        expect(lastOptions.onContextMenu).toBeTypeOf("function");
        expect(editor.focus).toHaveBeenCalled();
        expect(languageLabel(tab).textContent).toBe("plaintext");
    });

    it("记住的语言优先于扩展名猜测", async () => {
        rememberLanguage(REF.link, "javascript");
        await openReady();
        expect(lastOptions.language).toBe("javascript");
        expect(vi.mocked(createEditor).mock.calls[0][1].language).toBe("javascript");
    });

    it("预览模式以只读建立编辑器", async () => {
        settings = makeSettings({openMode: "preview"});
        const tab = await openReady();
        expect(lastOptions.readOnly).toBe(true);
        expect(readonlyIcon(tab).getAttribute("aria-label")).toBe("切到编辑");
    });

    it("行号、换行、连字的 auto 跟随思源配置", async () => {
        settings = makeSettings({lineNumbers: "auto", lineWrap: "auto", ligatures: "auto"});
        installConfig({
            editor: {codeSyntaxHighlightLineNum: true, codeLineWrap: false, codeLigatures: true},
        });
        await openReady();
        expect(lastOptions).toMatchObject({showLineNumbers: true, lineWrap: false, ligatures: true});
    });

    it("auto 在思源关闭时为假", async () => {
        settings = makeSettings({lineNumbers: "auto", lineWrap: "auto", ligatures: "auto"});
        installConfig({
            editor: {codeSyntaxHighlightLineNum: false, codeLineWrap: false, codeLigatures: false},
        });
        await openReady();
        expect(lastOptions).toMatchObject({showLineNumbers: false, lineWrap: false, ligatures: false});
    });

    it("工作区只读时直接显示提示，不去读文件", async () => {
        installConfig({readonly: true});
        const tab = openView();
        await vi.waitFor(() => {
            expect(tab.element.querySelector(".editor-siyuan__placeholder")?.textContent).toBe("工作区只读");
        });
        expect(tab.element.querySelector(".editor-siyuan__placeholder--error")).not.toBeNull();
        expect(resolveAsset).not.toHaveBeenCalled();
    });

    it("定位失败时显示错误", async () => {
        vi.mocked(resolveAsset).mockResolvedValue({kind: "error", message: "not found"});
        const tab = openView();
        await vi.waitFor(() => {
            expect(tab.element.querySelector(".editor-siyuan__placeholder")?.textContent).toBe("打开失败: not found");
        });
        expect(createEditor).not.toHaveBeenCalled();
    });

    it("文件超过上限时显示大小与上限，不读取正文", async () => {
        vi.mocked(resolveAsset).mockResolvedValue({
            kind: "ok",
            ref: {...REF, size: 6 * 1024 * 1024},
        });
        settings = makeSettings({maxSizeMB: 5});
        const tab = openView();
        await vi.waitFor(() => {
            expect(tab.element.querySelector(".editor-siyuan__placeholder")?.textContent)
                .toBe("文件过大（6.0 MB，上限 5 MB）");
        });
        expect(readAssetText).not.toHaveBeenCalled();
    });

    it("读取失败时显示错误", async () => {
        vi.mocked(readAssetText).mockRejectedValue(new Error("io error"));
        const tab = openView();
        await vi.waitFor(() => {
            expect(tab.element.querySelector(".editor-siyuan__placeholder")?.textContent)
                .toBe("打开失败: io error");
        });
    });

    it(".sy 预览走工作区文件接口并强制只读", async () => {
        const tab = await openReady(host({link: SY_REF.link, sy: true}));
        expect(resolveWorkspaceFile).toHaveBeenCalledWith(SY_REF.link);
        expect(resolveAsset).not.toHaveBeenCalled();
        expect(lastOptions.readOnly).toBe(true);
        expect(lastOptions.onContextMenu).toBeTypeOf("function");
        expect(tab.link).toBe(SY_REF.link);
    });

    it("移动端不拦截右键，交给系统菜单", async () => {
        __setFrontend("mobile");
        await openReady(host({link: REF.link}, {title: "a.txt", onClose: vi.fn()}));
        expect(lastOptions.onContextMenu).toBeUndefined();
    });

    it("桌面端浮层仍然用自己的右键菜单，并聚焦正文", async () => {
        await openReady(host({link: REF.link}, {title: "a.txt"}));
        expect(lastOptions.onContextMenu).toBeTypeOf("function");
        expect(editor.focus).toHaveBeenCalled();
    });

    it("移动端不自动聚焦，免得一打开就弹软键盘", async () => {
        __setFrontend("mobile");
        await openReady(host({link: REF.link}, {title: "a.txt", onClose: vi.fn()}));
        expect(editor.focus).not.toHaveBeenCalled();
    });

    it("销毁发生在加载完成前时不再建立编辑器", async () => {
        let finish!: (value: any) => void;
        vi.mocked(resolveAsset).mockReturnValue(new Promise((resolve) => {
            finish = resolve;
        }));
        const tab = openView();
        tab.dispose();
        finish({kind: "ok", ref: REF});
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(createEditor).not.toHaveBeenCalled();
    });
});

describe("暂存恢复", () => {
    it("暂存与磁盘内容不同时询问用户", async () => {
        putStash(REF.link, {text: "stashed", eol: "\r\n", bom: true, at: 1});
        const tab = openView();
        await vi.waitFor(() => expect(openConfirmDialog).toHaveBeenCalled());
        const options = vi.mocked(openConfirmDialog).mock.calls[0][0];
        expect(options.title).toBe("恢复未保存内容");
        expect(options.dismissable).toBe(false);

        options.actions.find((action) => action.primary)!.onClick();
        await vi.waitFor(() => expect(createEditor).toHaveBeenCalled());
        expect(lastOptions.doc).toBe("stashed");
        expect(tab.isDirty()).toBe(true);
        expect(lastOptions.readOnly).toBe(false);
    });

    it("选择忽略时载入磁盘内容并保留暂存", async () => {
        putStash(REF.link, {text: "stashed", eol: "\n", bom: false, at: 1});
        const tab = openView();
        await vi.waitFor(() => expect(openConfirmDialog).toHaveBeenCalled());
        vi.mocked(openConfirmDialog).mock.calls[0][0].actions
            .find((action) => !action.primary && !action.danger)!.onClick();
        await vi.waitFor(() => expect(createEditor).toHaveBeenCalled());
        expect(lastOptions.doc).toBe("hello");
        expect(tab.isDirty()).toBe(false);
        expect(stashedEntry(REF.link)?.text).toBe("stashed");
    });

    it("选择丢弃时删除暂存并载入磁盘内容", async () => {
        putStash(REF.link, {text: "stashed", eol: "\n", bom: false, at: 1});
        const tab = openView();
        await vi.waitFor(() => expect(openConfirmDialog).toHaveBeenCalled());
        vi.mocked(openConfirmDialog).mock.calls[0][0].actions
            .find((action) => action.danger)!.onClick();
        await vi.waitFor(() => expect(createEditor).toHaveBeenCalled());
        expect(lastOptions.doc).toBe("hello");
        expect(tab.isDirty()).toBe(false);
        expect(stashedEntry(REF.link)).toBeUndefined();
    });

    it("对话框被别的路径关掉时按忽略处理", async () => {
        putStash(REF.link, {text: "stashed", eol: "\n", bom: false, at: 1});
        const tab = openView();
        await vi.waitFor(() => expect(openConfirmDialog).toHaveBeenCalled());
        vi.mocked(openConfirmDialog).mock.calls[0][0].onCancel!();
        await vi.waitFor(() => expect(createEditor).toHaveBeenCalled());
        expect(lastOptions.doc).toBe("hello");
        expect(tab.isDirty()).toBe(false);
    });

    it("暂存与磁盘一致时不询问", async () => {
        putStash(REF.link, {text: "hello", eol: "\n", bom: false, at: 1});
        await openReady();
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("关闭暂存功能时不询问", async () => {
        settings = makeSettings({stashUnsaved: false});
        putStash(REF.link, {text: "stashed", eol: "\n", bom: false, at: 1});
        await openReady();
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it(".sy 预览不询问暂存", async () => {
        putStash(SY_REF.link, {text: "stashed", eol: "\n", bom: false, at: 1});
        await openReady(host({link: SY_REF.link, sy: true}));
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });
});

describe("保存与脏标记", () => {
    it("正文变化后标记为脏，并更新保存按钮", async () => {
        const tab = await openReady();
        lastOptions.onChange();
        expect(tab.isDirty()).toBe(true);
        expect(saveIcon(tab).classList.contains("editor-siyuan__icon--dirty")).toBe(true);
        expect(saveIcon(tab).getAttribute("aria-label")).toBe("保存（有改动）");
    });

    it("保存成功后清掉脏标记与暂存", async () => {
        const tab = await openReady();
        putStash(REF.link, {text: "old", eol: "\n", bom: false, at: 1});
        lastOptions.onChange();
        saveIcon(tab).click();
        await vi.waitFor(() => expect(writeAssetText).toHaveBeenCalled());
        expect(writeAssetText).toHaveBeenCalledWith(REF, {text: "hello", eol: "\n", bom: false});
        expect(tab.isDirty()).toBe(false);
        expect(stashedEntry(REF.link)).toBeUndefined();
        expect(showMessage).toHaveBeenCalledWith("已保存", 2000);
    });

    it("保存失败时保留脏标记并提示错误", async () => {
        vi.mocked(writeAssetText).mockResolvedValue("denied");
        const tab = await openReady();
        lastOptions.onChange();
        saveIcon(tab).click();
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(showMessage).toHaveBeenCalledWith("保存失败: denied", 6000, "error");
        expect(tab.isDirty()).toBe(true);
    });

    it("只读模式不写盘", async () => {
        settings = makeSettings({openMode: "preview"});
        const tab = await openReady();
        await expect(tab.save()).resolves.toBe(false);
        expect(writeAssetText).not.toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith("只读模式不能保存");
    });

    it(".sy 预览保存时给出专用提示", async () => {
        const tab = await openReady(host({link: SY_REF.link, sy: true}));
        await expect(tab.save()).resolves.toBe(false);
        expect(writeAssetText).not.toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith("文档预览不能保存", 3000);
    });

    it("编辑器就绪前保存直接返回 false", async () => {
        const tab = openView();
        await expect(tab.save()).resolves.toBe(false);
        expect(writeAssetText).not.toHaveBeenCalled();
    });

    it("discard 清掉脏标记与暂存", async () => {
        const tab = await openReady();
        lastOptions.onChange();
        putStash(REF.link, {text: "old", eol: "\n", bom: false, at: 1});
        tab.discard();
        expect(tab.isDirty()).toBe(false);
        expect(stashedEntry(REF.link)).toBeUndefined();
        expect(saveIcon(tab).getAttribute("aria-label")).toBe("保存");
    });
});

describe("操作条", () => {
    it("只读按钮切换编辑器并换图标与文案", async () => {
        const tab = await openReady();
        readonlyIcon(tab).click();
        expect(setEditorReadOnly).toHaveBeenCalledWith(editor, true);
        expect(readonlyIcon(tab).getAttribute("aria-label")).toBe("切到编辑");
        expect(readonlyIcon(tab).innerHTML).toContain("#iconEdit");

        readonlyIcon(tab).click();
        expect(setEditorReadOnly).toHaveBeenLastCalledWith(editor, false);
        expect(readonlyIcon(tab).getAttribute("aria-label")).toBe("切到预览");
    });

    it("查找按钮打开搜索面板", async () => {
        const tab = await openReady();
        searchIcon(tab).click();
        expect(toggleSearchPanel).toHaveBeenCalledWith(editor);
    });

    it("查找按钮右键只收起面板", async () => {
        const tab = await openReady();
        const event = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        searchIcon(tab).dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(closeSearch).toHaveBeenCalledWith(editor);
    });

    it("语言标签打开语言菜单，选中后记住并切换", async () => {
        const tab = await openReady();
        languageLabel(tab).click();
        expect(openLanguageMenu).toHaveBeenCalled();
        const [anchor, current, _t, onPick] = vi.mocked(openLanguageMenu).mock.calls[0];
        expect(anchor).toBe(languageLabel(tab));
        expect(current).toBe("plaintext");
        onPick("javascript");
        expect(setEditorLanguage).toHaveBeenCalledWith(editor, "javascript");
        expect(rememberedLanguage(REF.link)).toBe("javascript");
        expect(languageLabel(tab).textContent).toBe("javascript");
    });

    it("更多按钮打开菜单，位置右对齐", async () => {
        const tab = await openReady();
        moreIcon(tab).click();
        expect(openMoreMenu).toHaveBeenCalledWith(
            expect.objectContaining({view: editor, language: "plaintext", link: REF.link, readOnly: false}),
            0,
            0,
        );
    });

    it("编辑器就绪前点更多按钮没有反应", () => {
        const tab = openView();
        moreIcon(tab).click();
        expect(openMoreMenu).not.toHaveBeenCalled();
    });

    it("移动端关闭按钮把动作交给宿主", async () => {
        const onClose = vi.fn();
        const tab = await openReady(host({link: REF.link}, {title: "a.txt", onClose}));
        tab.element.querySelector<HTMLElement>('[data-type="close"]')!.click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("页签注册表", () => {
    it("按链接查找页签", async () => {
        const tab = await openReady();
        expect(allTabs()).toEqual([tab]);
        expect(tabFor(REF.link)).toBe(tab);
        expect(tabFor("assets/missing.txt")).toBeUndefined();
    });

    it("focusin 后 focusedTab 返回该页签", async () => {
        const first = await openReady();
        const second = await openReady(host({link: "assets/b.txt"}));
        expect(focusedTab()).toBe(second);
        first.element.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        expect(focusedTab()).toBe(first);
    });

    it("销毁后从注册表移除", async () => {
        const tab = await openReady();
        tab.dispose();
        expect(allTabs()).toHaveLength(0);
        expect(tabFor(REF.link)).toBeUndefined();
        expect(focusedTab()).toBeUndefined();
        expect(tab.element.isConnected).toBe(false);
    });
});

describe("销毁", () => {
    it("记住光标并销毁编辑器", async () => {
        const tab = await openReady();
        tab.dispose();
        expect(editor.destroy).toHaveBeenCalled();
        expect(rememberedCursor(REF.link)).toEqual({anchor: 3, scrollTop: 4});
    });

    it("关闭光标记忆时不写入", async () => {
        settings = makeSettings({restoreCursor: false});
        const tab = await openReady();
        tab.dispose();
        expect(rememberedCursor(REF.link)).toBeUndefined();
    });

    it("有未保存改动时写入暂存", async () => {
        const tab = await openReady();
        lastOptions.onChange();
        tab.dispose();
        expect(stashedEntry(REF.link)).toMatchObject({text: "hello", eol: "\n", bom: false});
    });

    it("关闭暂存功能时不写入", async () => {
        settings = makeSettings({stashUnsaved: false});
        const tab = await openReady();
        lastOptions.onChange();
        tab.dispose();
        expect(stashedEntry(REF.link)).toBeUndefined();
    });

    it("没有未保存改动时不写入暂存", async () => {
        const tab = await openReady();
        tab.dispose();
        expect(stashedEntry(REF.link)).toBeUndefined();
    });

    it("恢复光标：有记忆时交给 restoreCursor", async () => {
        rememberCursor(REF.link, {anchor: 7, scrollTop: 8});
        const tab = await openReady();
        expect(restoreCursor).toHaveBeenCalledWith(editor, {anchor: 7, scrollTop: 8});
        tab.dispose();
    });

    it("关闭光标恢复时不调用 restoreCursor", async () => {
        rememberCursor(REF.link, {anchor: 7, scrollTop: 8});
        settings = makeSettings({restoreCursor: false});
        await openReady();
        expect(restoreCursor).not.toHaveBeenCalled();
    });
});

describe("字号", () => {
    it("自定义字号写成根元素上的 CSS 变量", async () => {
        settings = makeSettings({fontSize: 18});
        const tab = await openReady();
        expect(tab.element.style.getPropertyValue("--editor-siyuan-font-size")).toBe("18px");
    });

    it("跟随思源时不写这个变量", async () => {
        const tab = await openReady();
        expect(tab.element.style.getPropertyValue("--editor-siyuan-font-size")).toBe("");
    });

    it("设置改动后对已打开的页签立即生效", async () => {
        const tab = await openReady();
        refreshEditorSettings(makeSettings({fontSize: 20}));
        expect(tab.element.style.getPropertyValue("--editor-siyuan-font-size")).toBe("20px");
        refreshEditorSettings(makeSettings({fontSize: 0}));
        expect(tab.element.style.getPropertyValue("--editor-siyuan-font-size")).toBe("");
    });
});

describe("设置联动", () => {
    it("refreshEditorSettings 按设置与思源配置重算三项", async () => {
        const first = await openReady();
        const second = await openReady(host({link: "assets/b.txt"}));
        await vi.waitFor(() => expect(createEditor).toHaveBeenCalledTimes(2));
        refreshEditorSettings(
            makeSettings({lineNumbers: "auto", lineWrap: "auto", ligatures: "auto"}),
            {codeSyntaxHighlightLineNum: true, codeLineWrap: false, codeLigatures: true},
        );
        for (const tab of [first, second]) {
            expect(tab).toBeDefined();
        }
        expect(setEditorLineNumbers).toHaveBeenCalledTimes(2);
        expect(setEditorLineNumbers).toHaveBeenLastCalledWith(editor, true);
        expect(setEditorLineWrap).toHaveBeenLastCalledWith(editor, false);
        expect(setEditorLigatures).toHaveBeenLastCalledWith(editor, true);
    });

    it("watchEditorConfig 只响应 setConf 且带 editor 的事件", async () => {
        await openReady();
        watchEditorConfig(plugin as unknown as SiyuanPlugin, () => settings);

        plugin.eventBus.emit("ws-main", {cmd: "setConf", data: {editor: {
            codeLineWrap: false,
            codeLigatures: true,
            codeSyntaxHighlightLineNum: true,
        }}});
        expect(setEditorLineNumbers).toHaveBeenCalledWith(editor, true);
        expect(setEditorLineWrap).toHaveBeenCalledWith(editor, false);
        expect(setEditorLigatures).toHaveBeenCalledWith(editor, true);

        vi.mocked(setEditorLineNumbers).mockClear();
        plugin.eventBus.emit("ws-main", {cmd: "setAppearance", data: {editor: {
            codeLineWrap: true,
            codeLigatures: true,
            codeSyntaxHighlightLineNum: true,
        }}});
        plugin.eventBus.emit("ws-main", {cmd: "setConf", data: {}});
        expect(setEditorLineNumbers).not.toHaveBeenCalled();
    });
});

describe("撤销与重做", () => {
    it("编辑模式下两个按钮可见", async () => {
        const tab = await openReady();
        expect(undoIcon(tab).classList.contains("fn__none")).toBe(false);
        expect(redoIcon(tab).classList.contains("fn__none")).toBe(false);
        expect(undoIcon(tab).getAttribute("aria-label")).toBe("撤销");
        expect(redoIcon(tab).getAttribute("aria-label")).toBe("重做");
    });

    it("预览模式下整对隐藏", async () => {
        settings = makeSettings({openMode: "preview"});
        const tab = await openReady();
        expect(undoIcon(tab).classList.contains("fn__none")).toBe(true);
        expect(redoIcon(tab).classList.contains("fn__none")).toBe(true);
    });

    it("切回编辑后重新出现", async () => {
        settings = makeSettings({openMode: "preview"});
        const tab = await openReady();
        readonlyIcon(tab).click();
        expect(undoIcon(tab).classList.contains("fn__none")).toBe(false);
        expect(redoIcon(tab).classList.contains("fn__none")).toBe(false);
    });

    it("撤销栈为空时置灰且点了没反应", async () => {
        const tab = await openReady();
        expect(undoIcon(tab).classList.contains("editor-siyuan__icon--disabled")).toBe(true);
        expect(undoIcon(tab).getAttribute("aria-disabled")).toBe("true");
        undoIcon(tab).click();
        redoIcon(tab).click();
        expect(applyUndo).not.toHaveBeenCalled();
        expect(applyRedo).not.toHaveBeenCalled();
    });

    it("有可撤销的内容时按钮可点，点了走 CodeMirror 的撤销", async () => {
        vi.mocked(canUndo).mockReturnValue(true);
        const tab = await openReady();
        expect(undoIcon(tab).classList.contains("editor-siyuan__icon--disabled")).toBe(false);
        undoIcon(tab).click();
        expect(applyUndo).toHaveBeenCalledWith(editor);
    });

    it("正文改动后按新的栈深重算按钮状态", async () => {
        const tab = await openReady();
        expect(redoIcon(tab).classList.contains("editor-siyuan__icon--disabled")).toBe(true);
        vi.mocked(canRedo).mockReturnValue(true);
        lastOptions.onChange();
        expect(redoIcon(tab).classList.contains("editor-siyuan__icon--disabled")).toBe(false);
        redoIcon(tab).click();
        expect(applyRedo).toHaveBeenCalledWith(editor);
    });
});

describe("换行开关", () => {
    it("初始状态跟随设置", async () => {
        const tab = await openReady();
        // 默认 lineWrap: auto，配合思源的 codeLineWrap: true
        expect(wrapIcon(tab).classList.contains("editor-siyuan__icon--active")).toBe(true);
        expect(wrapIcon(tab).getAttribute("aria-pressed")).toBe("true");
        expect(wrapIcon(tab).getAttribute("aria-label")).toBe("换行");
    });

    it("思源关掉代码换行时初始为关闭", async () => {
        installConfig({editor: {codeLineWrap: false}});
        const tab = await openReady();
        expect(wrapIcon(tab).classList.contains("editor-siyuan__icon--active")).toBe(false);
        expect(wrapIcon(tab).getAttribute("aria-pressed")).toBe("false");
    });

    it("点一下切到关闭，只作用于本次打开", async () => {
        const tab = await openReady();
        wrapIcon(tab).click();
        expect(setEditorLineWrap).toHaveBeenLastCalledWith(editor, false);
        expect(wrapIcon(tab).classList.contains("editor-siyuan__icon--active")).toBe(false);
        expect(wrapIcon(tab).getAttribute("aria-pressed")).toBe("false");
        // 设置里的默认值不能被改写
        expect(settings.lineWrap).toBe("auto");

        // 手动切过之后，设置联动不再覆盖这个页签的选择
        tab.setLineWrap(true);
        expect(setEditorLineWrap).toHaveBeenCalledTimes(1);

        wrapIcon(tab).click();
        expect(setEditorLineWrap).toHaveBeenLastCalledWith(editor, true);
        expect(wrapIcon(tab).classList.contains("editor-siyuan__icon--active")).toBe(true);
    });

    it("编辑器就绪前点换行按钮没有反应", () => {
        const tab = openView();
        wrapIcon(tab).click();
        expect(setEditorLineWrap).not.toHaveBeenCalled();
    });
});
