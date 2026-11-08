import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Menu, Plugin, __setFrontend, openTab} from "../support/siyuan";
import {installConfig, makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {fileIcon} from "../../src/file-icon";
import {ICON_TAB} from "../../src/icons";
import {openMobileEditor} from "../../src/mobile";
import {openPopupEditor} from "../../src/popup";
import {
    openEditor,
    openFileList,
    openSyPreview,
    registerOpenHandlers,
    TAB_TYPE,
    type IOpenDeps,
} from "../../src/open";

vi.mock("../../src/mobile", () => ({openMobileEditor: vi.fn()}));
vi.mock("../../src/popup", () => ({openPopupEditor: vi.fn()}));

const t = makeT({
    openWithEditor: "使用 Editor 打开",
    previewSyMenu: "预览 .sy 文件",
});

let settings = makeSettings();
let plugin: Plugin;
let deps: IOpenDeps;

beforeEach(() => {
    settings = makeSettings();
    plugin = new Plugin();
    deps = {
        app: {} as any,
        plugin: plugin as unknown as SiyuanPlugin,
        t,
        settings: () => settings,
    };
});

function mouse(options: MouseEventInit = {}): MouseEvent {
    return new MouseEvent("click", options);
}

function openedModel(link: string) {
    const headElement = document.createElement("div");
    const switchTab = vi.fn();
    const model = {
        data: {link},
        tab: {id: `tab-${link}`, headElement, parent: {switchTab}},
    };
    plugin.openedTabs["editor-siyuan" + TAB_TYPE] = [model];
    return {model, headElement, switchTab};
}

describe("openEditor", () => {
    it("桌面端用固定页签类型打开，标题只放文件名", () => {
        openEditor(deps, "assets/a.txt");
        expect(openTab).toHaveBeenCalledTimes(1);
        const options = vi.mocked(openTab).mock.calls[0][0] as any;
        expect(options.app).toBe(deps.app);
        expect(options.custom).toEqual({
            id: "editor-siyuan" + TAB_TYPE,
            icon: ICON_TAB,
            title: "a.txt",
            data: {link: "assets/a.txt"},
        });
    });

    it("子目录里的资源标题保留相对路径", () => {
        openEditor(deps, "assets/notes/a.txt");
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.title).toBe("notes/a.txt");
    });

    it("同一资源已经打开时只聚焦，不再开第二个页签", () => {
        const {headElement, switchTab} = openedModel("assets/a.txt");
        openEditor(deps, "assets/a.txt");
        expect(openTab).not.toHaveBeenCalled();
        expect(switchTab).toHaveBeenCalledWith(headElement, true);
    });

    it("其它资源的页签不影响判断", () => {
        openedModel("assets/b.txt");
        openEditor(deps, "assets/a.txt");
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("移动端改走全屏对话框", () => {
        __setFrontend("mobile");
        openEditor(deps, "assets/notes/a.txt");
        expect(openTab).not.toHaveBeenCalled();
        expect(openMobileEditor).toHaveBeenCalledWith(deps, {link: "assets/notes/a.txt"}, "notes/a.txt");
    });

    it("形态选成浮层时改走浮层", () => {
        settings = makeSettings({desktopForm: "dialog"});
        openEditor(deps, "assets/notes/a.txt");
        expect(openTab).not.toHaveBeenCalled();
        expect(openPopupEditor).toHaveBeenCalledWith(deps, {link: "assets/notes/a.txt"}, "notes/a.txt");
    });

    it("思源弹出的独立窗口没有页签栏，一律用浮层", () => {
        __setFrontend("desktop-window");
        openEditor(deps, "assets/a.txt");
        expect(openTab).not.toHaveBeenCalled();
        expect(openPopupEditor).toHaveBeenCalledWith(deps, {link: "assets/a.txt"}, "a.txt");
    });

    it("页签形态下不走浮层", () => {
        openEditor(deps, "assets/a.txt");
        expect(openPopupEditor).not.toHaveBeenCalled();
    });
});

describe("openSyPreview", () => {
    it("拼出工作区相对路径并以只读标记打开", () => {
        openSyPreview(deps, "box-id", "/20210808180117.sy");
        const custom = (vi.mocked(openTab).mock.calls[0][0] as any).custom;
        expect(custom).toEqual({
            id: "editor-siyuan" + TAB_TYPE,
            icon: fileIcon("/data/box-id/20210808180117.sy"),
            title: "20210808180117",
            data: {link: "/data/box-id/20210808180117.sy", sy: true},
        });
    });

    it("标题去掉 .sy 后缀，保留子目录", () => {
        openSyPreview(deps, "box-id", "/notes/doc.SY");
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.title).toBe("doc");
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.data.link)
            .toBe("/data/box-id/notes/doc.SY");
    });

    it("已经打开时只聚焦", () => {
        const {switchTab} = openedModel("/data/box-id/doc.sy");
        openSyPreview(deps, "box-id", "/doc.sy");
        expect(openTab).not.toHaveBeenCalled();
        expect(switchTab).toHaveBeenCalledTimes(1);
    });

    it("移动端用文档名作标题", () => {
        __setFrontend("mobile");
        openSyPreview(deps, "box-id", "/notes/doc.sy");
        expect(openMobileEditor).toHaveBeenCalledWith(
            deps,
            {link: "/data/box-id/notes/doc.sy", sy: true},
            "doc",
        );
    });

    it("浮层形态下 .sy 预览也用浮层", () => {
        settings = makeSettings({desktopForm: "dialog"});
        openSyPreview(deps, "box-id", "/notes/doc.sy");
        expect(openTab).not.toHaveBeenCalled();
        expect(openPopupEditor).toHaveBeenCalledWith(
            deps,
            {link: "/data/box-id/notes/doc.sy", sy: true},
            "doc",
        );
    });
});

describe("open-asset 接管", () => {
    beforeEach(() => {
        registerOpenHandlers(deps);
    });

    function emit(path: string | null | undefined, event: MouseEvent = mouse()) {
        return plugin.eventBus.emit("open-asset", {path, event});
    }

    it("默认接管单击，并阻止思源的默认打开", () => {
        const event = emit("assets/a.txt");
        expect(event.defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("带查询串的链接去掉查询串后再当页签键", () => {
        emit("assets/a.txt?box=20210808180117");
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.data.link).toBe("assets/a.txt");
    });

    it("非白名单扩展名交给思源", () => {
        const event = emit("assets/a.exe");
        expect(event.defaultPrevented).toBe(false);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("不是 assets/ 链接的一律不管", () => {
        for (const path of ["", "data/assets/a.txt", "assetsx/a.txt", "file:///a.txt"]) {
            expect(emit(path).defaultPrevented, String(path)).toBe(false);
        }
        expect(openTab).not.toHaveBeenCalled();
    });

    it("缺少 path 时不管", () => {
        expect(emit(undefined).defaultPrevented).toBe(false);
        expect(emit(null).defaultPrevented).toBe(false);
    });

    it("其它手势交回思源", () => {
        expect(emit("assets/a.txt", mouse({ctrlKey: true})).defaultPrevented).toBe(false);
        expect(emit("assets/a.txt", mouse({altKey: true})).defaultPrevented).toBe(false);
        expect(emit("assets/a.txt", mouse({shiftKey: true})).defaultPrevented).toBe(false);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("接管手势改成 Ctrl 单击后只响应 Ctrl 单击", () => {
        settings = makeSettings({takeover: "ctrlClick"});
        expect(emit("assets/a.txt", mouse({ctrlKey: true})).defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
        expect(emit("assets/a.txt").defaultPrevented).toBe(false);
    });

    it("接管手势改成 Alt 单击", () => {
        settings = makeSettings({takeover: "altClick"});
        expect(emit("assets/a.txt", mouse({altKey: true})).defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("接管手势改成 Shift 单击", () => {
        settings = makeSettings({takeover: "shiftClick"});
        expect(emit("assets/a.txt", mouse({shiftKey: true})).defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("多个修饰键同时按下时按单击处理", () => {
        expect(emit("assets/a.txt", mouse({ctrlKey: true, altKey: true})).defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("mac 上 Ctrl 单击的 ctrl 档是 ⌘ 而不是 Control", () => {
        installConfig({system: {os: "darwin"}});
        settings = makeSettings({takeover: "ctrlClick"});
        expect(emit("assets/a.txt", mouse({metaKey: true})).defaultPrevented).toBe(true);
        expect(openTab).toHaveBeenCalledTimes(1);
        expect(emit("assets/a.txt", mouse({ctrlKey: true})).defaultPrevented).toBe(false);
    });

    it("takeover=none 时一律交给思源", () => {
        settings = makeSettings({takeover: "none"});
        expect(emit("assets/a.txt").defaultPrevented).toBe(false);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("移动端把桌面端存下的 Alt 单击折算成单击", () => {
        __setFrontend("mobile");
        settings = makeSettings({takeover: "altClick"});
        const event = emit("assets/a.txt");
        expect(event.defaultPrevented).toBe(true);
        expect(openMobileEditor).toHaveBeenCalled();
        expect(openTab).not.toHaveBeenCalled();
    });

    it("移动端 takeover=none 仍然不接管", () => {
        __setFrontend("mobile");
        settings = makeSettings({takeover: "none"});
        expect(emit("assets/a.txt").defaultPrevented).toBe(false);
        expect(openMobileEditor).not.toHaveBeenCalled();
    });

    it("没有 event 时按单击处理", () => {
        const event = plugin.eventBus.emit("open-asset", {path: "assets/a.txt"});
        expect(event.defaultPrevented).toBe(true);
    });
});

describe("open-menu-link", () => {
    beforeEach(() => {
        registerOpenHandlers(deps);
    });

    function emit(href: string | null, menu = new Menu()) {
        const element = document.createElement("a");
        if (href !== null) {
            element.setAttribute("data-href", href);
        }
        plugin.eventBus.emit("open-menu-link", {element, menu});
        return menu;
    }

    it("给白名单资源加一条插件菜单", () => {
        const menu = emit("assets/a.txt");
        expect(menu.items).toHaveLength(1);
        expect(menu.items[0]).toMatchObject({
            id: "editorSiyuanOpen",
            label: "使用 Editor 打开",
            icon: ICON_TAB,
        });
    });

    it("点击菜单项打开页签", () => {
        const menu = emit("assets/a.txt");
        menu.items[0].click!();
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it("不在白名单、没有 data-href 或没有元素时不加菜单", () => {
        expect(emit("assets/a.exe").items).toHaveLength(0);
        expect(emit(null).items).toHaveLength(0);
        const menu = new Menu();
        plugin.eventBus.emit("open-menu-link", {element: undefined, menu});
        expect(menu.items).toHaveLength(0);
    });
});

describe("笔记文档的 .sy 预览菜单", () => {
    beforeEach(() => {
        registerOpenHandlers(deps);
    });

    function docTree(path: string, type = "doc", menu = new Menu(), items: any[] = [{notebookId: "box", path}]) {
        plugin.eventBus.emit("open-menu-doctree", {type, items, menu});
        return menu;
    }

    it("previewSy 打开时给 .sy 文档加菜单项", () => {
        settings = makeSettings({previewSy: true});
        const menu = docTree("/doc.sy");
        expect(menu.items).toHaveLength(1);
        expect(menu.items[0]).toMatchObject({
            id: "editorSiyuanPreviewSy",
            label: "预览 .sy 文件",
            icon: fileIcon("/doc.sy"),
        });
        menu.items[0].click!();
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.data)
            .toEqual({link: "/data/box/doc.sy", sy: true});
    });

    it("previewSy 关闭时不加菜单", () => {
        settings = makeSettings({previewSy: false});
        expect(docTree("/doc.sy").items).toHaveLength(0);
    });

    it("非文档类型不加菜单", () => {
        settings = makeSettings({previewSy: true});
        expect(docTree("/doc.sy", "file").items).toHaveLength(0);
    });

    it("没有选中项时不加菜单", () => {
        settings = makeSettings({previewSy: true});
        expect(docTree("/doc.sy", "doc", new Menu(), []).items).toHaveLength(0);
    });

    it("非 .sy 路径不加菜单", () => {
        settings = makeSettings({previewSy: true});
        expect(docTree("/doc.md").items).toHaveLength(0);
        expect(docTree("/doc.SY").items).toHaveLength(1);
    });

    it("标题图标入口同样加菜单", () => {
        settings = makeSettings({previewSy: true});
        const menu = new Menu();
        plugin.eventBus.emit("click-editortitleicon", {
            protyle: {notebookId: "box", path: "/doc.sy"},
            menu,
        });
        expect(menu.items).toHaveLength(1);
        menu.items[0].click!();
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.title).toBe("doc");
    });

    it("标题图标缺少笔记本或路径时不加菜单", () => {
        settings = makeSettings({previewSy: true});
        const menu = new Menu();
        plugin.eventBus.emit("click-editortitleicon", {protyle: {notebookId: "", path: "/doc.sy"}, menu});
        plugin.eventBus.emit("click-editortitleicon", {protyle: {notebookId: "box", path: ""}, menu});
        expect(menu.items).toHaveLength(0);
    });
});

describe("openFileList", () => {
    const FILES = [
        {link: "/data/a.json", title: "a.json", workspace: true},
        {link: "/data/b.json", title: "b.json", workspace: true},
    ];

    it("桌面端开页签，候选表与数据一起带上", () => {
        openFileList(deps, FILES);
        expect(openTab).toHaveBeenCalledTimes(1);
        const custom = (vi.mocked(openTab).mock.calls[0][0] as any).custom;
        expect(custom.id).toBe("editor-siyuan" + TAB_TYPE);
        expect(custom.icon).toBe(fileIcon("/data/a.json"));
        expect(custom.title).toBe("a.json");
        expect(custom.data).toEqual({link: "/data/a.json", workspace: true, sy: undefined, files: FILES});
    });

    it("指定起点时从那个文件开始", () => {
        openFileList(deps, FILES, "/data/b.json");
        expect((vi.mocked(openTab).mock.calls[0][0] as any).custom.title).toBe("b.json");
    });

    it("移动端改走全屏对话框，并带上候选表", () => {
        __setFrontend("mobile");
        openFileList(deps, FILES);
        expect(openTab).not.toHaveBeenCalled();
        expect(openMobileEditor).toHaveBeenCalledWith(
            deps,
            {link: "/data/a.json", workspace: true, sy: undefined},
            "a.json",
            FILES,
        );
    });

    it("形态选成浮层时改走浮层", () => {
        settings = makeSettings({desktopForm: "dialog"});
        openFileList(deps, FILES);
        expect(openTab).not.toHaveBeenCalled();
        expect(openPopupEditor).toHaveBeenCalledWith(
            deps,
            {link: "/data/a.json", workspace: true, sy: undefined},
            "a.json",
            FILES,
        );
    });

    it("同一个文件已经开着时只聚焦", () => {
        const {switchTab, headElement} = openedModel("/data/a.json");
        openFileList(deps, FILES);
        expect(openTab).not.toHaveBeenCalled();
        expect(switchTab).toHaveBeenCalledWith(headElement, true);
    });

    it("候选为空时什么都不做", () => {
        openFileList(deps, []);
        expect(openTab).not.toHaveBeenCalled();
    });
});
