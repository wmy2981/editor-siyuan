import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Plugin, __setActiveTab, __setFrontend} from "../support/siyuan";
import {installConfig, makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {openConfirmDialog} from "../../src/dialog";
import {registerCloseGuard} from "../../src/close-guard";
import {confirmClose} from "../../src/unsaved";

const {tabs} = vi.hoisted(() => ({tabs: [] as any[]}));

vi.mock("../../src/view", () => ({
    allTabs: () => tabs,
    tabFor: (link: string) => tabs.find((tab) => tab.link === link),
}));
vi.mock("../../src/dialog", () => ({openConfirmDialog: vi.fn()}));

const t = makeT({
    closeTitle: "关闭未保存的页签",
    closeBody: "{file} 有未保存的改动",
    cancel: "取消",
    closeDiscard: "不保存",
    save: "保存",
});

let settings = makeSettings();
let plugin: Plugin;

function closable(options: {link?: string; dirty?: boolean; saved?: boolean} = {}): any {
    return {
        link: options.link ?? "assets/a.txt",
        isDirty: vi.fn(() => options.dirty ?? true),
        save: vi.fn(async () => options.saved ?? true),
        discard: vi.fn(),
    };
}

function model(id = "tab-1", link = "assets/a.txt") {
    const removeTab = vi.fn();
    const entry = {
        data: {link},
        tab: {id, headElement: document.createElement("div"), parent: {removeTab}},
    };
    plugin.openedTabs[id] = [entry];
    return {entry, removeTab};
}

function header(id = "tab-1", withClose = true): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-type", "tab-header");
    element.setAttribute("data-id", id);
    if (withClose) {
        const close = document.createElement("span");
        close.className = "item__close";
        element.append(close);
    }
    document.body.append(element);
    return element;
}

function click(element: Element, detail = 1): MouseEvent {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true, detail});
    element.dispatchEvent(event);
    return event;
}

function keydown(options: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...options});
    window.dispatchEvent(event);
    return event;
}

beforeAll(() => {
    plugin = new Plugin();
    __setFrontend("browser-desktop");
    registerCloseGuard({
        plugin: plugin as unknown as SiyuanPlugin,
        t,
        settings: () => settings,
    });
});

beforeEach(() => {
    settings = makeSettings();
    tabs.length = 0;
    plugin.openedTabs = {};
    __setActiveTab(undefined);
    document.body.innerHTML = "";
});

describe("confirmClose", () => {
    it("没有未保存改动时直接放行", () => {
        const proceed = vi.fn();
        confirmClose(closable({dirty: false}), t, () => settings, proceed);
        expect(proceed).toHaveBeenCalledTimes(1);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("关闭了关闭确认时直接放行", () => {
        settings = makeSettings({confirmOnClose: false});
        const proceed = vi.fn();
        confirmClose(closable(), t, () => settings, proceed);
        expect(proceed).toHaveBeenCalledTimes(1);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("有改动时弹出三选一对话框", () => {
        confirmClose(closable(), t, () => settings, vi.fn());
        const options = vi.mocked(openConfirmDialog).mock.calls[0][0];
        expect(options.title).toBe("关闭未保存的页签");
        expect(options.text).toBe("a.txt 有未保存的改动");
        expect(options.cancelLabel).toBe("取消");
        expect(options.actions.map((action) => action.label)).toEqual(["不保存", "保存"]);
        expect(options.actions[0].danger).toBe(true);
        expect(options.actions[1].primary).toBe(true);
    });

    it("不保存：丢弃改动后继续关闭", () => {
        const view = closable();
        const proceed = vi.fn();
        confirmClose(view, t, () => settings, proceed);
        vi.mocked(openConfirmDialog).mock.calls[0][0].actions[0].onClick();
        expect(view.discard).toHaveBeenCalledTimes(1);
        expect(proceed).toHaveBeenCalledTimes(1);
    });

    it("保存成功后才继续关闭", async () => {
        const view = closable({saved: true});
        const proceed = vi.fn();
        confirmClose(view, t, () => settings, proceed);
        vi.mocked(openConfirmDialog).mock.calls[0][0].actions[1].onClick();
        expect(view.save).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    });

    it("保存失败时不继续关闭", async () => {
        const view = closable({saved: false});
        const proceed = vi.fn();
        confirmClose(view, t, () => settings, proceed);
        vi.mocked(openConfirmDialog).mock.calls[0][0].actions[1].onClick();
        await vi.waitFor(() => expect(view.save).toHaveBeenCalled());
        await Promise.resolve();
        expect(proceed).not.toHaveBeenCalled();
    });

    it("取消不做任何事，关闭动作已被拦下", () => {
        const view = closable();
        const proceed = vi.fn();
        confirmClose(view, t, () => settings, proceed);
        vi.mocked(openConfirmDialog).mock.calls[0][0].onCancel!();
        expect(view.discard).not.toHaveBeenCalled();
        expect(proceed).not.toHaveBeenCalled();
    });
});

describe("页签关闭按钮与双击", () => {
    it("点关闭按钮且有改动时拦下并询问", () => {
        const {removeTab} = model();
        tabs.push(closable());
        const element = header();
        const event = click(element.querySelector(".item__close")!);
        expect(event.defaultPrevented).toBe(true);
        expect(openConfirmDialog).toHaveBeenCalledTimes(1);

        vi.mocked(openConfirmDialog).mock.calls[0][0].actions[0].onClick();
        expect(removeTab).toHaveBeenCalledWith("tab-1");
    });

    it("没有改动时放行", () => {
        model();
        tabs.push(closable({dirty: false}));
        const event = click(header().querySelector(".item__close")!);
        expect(event.defaultPrevented).toBe(false);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("关闭了关闭确认时放行", () => {
        model();
        settings = makeSettings({confirmOnClose: false});
        tabs.push(closable());
        const event = click(header().querySelector(".item__close")!);
        expect(event.defaultPrevented).toBe(false);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("不是本插件的页签时放行", () => {
        tabs.push(closable());
        const event = click(header("other-tab").querySelector(".item__close")!);
        expect(event.defaultPrevented).toBe(false);
    });

    it("双击页签关闭：开启时拦下", () => {
        model();
        tabs.push(closable());
        const element = header("tab-1", false);
        const event = click(element, 2);
        expect(event.defaultPrevented).toBe(true);
        expect(openConfirmDialog).toHaveBeenCalled();
    });

    it("双击页签关闭：关闭该功能时放行", () => {
        installConfig({fileTree: {closeTabOnDoubleClick: false}});
        model();
        tabs.push(closable());
        const event = click(header("tab-1", false), 2);
        expect(event.defaultPrevented).toBe(false);
    });

    it("单击页签本身不拦", () => {
        model();
        tabs.push(closable());
        const event = click(header("tab-1", false), 1);
        expect(event.defaultPrevented).toBe(false);
    });

    it("点击页签里的其它元素不拦", () => {
        model();
        tabs.push(closable());
        const element = header("tab-1", false);
        const other = document.createElement("span");
        element.append(other);
        expect(click(other).defaultPrevented).toBe(false);
    });
});

describe("关闭快捷键", () => {
    it("Ctrl+W 且有改动时拦下并询问", () => {
        const {entry, removeTab} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        const event = keydown({key: "w", ctrlKey: true});
        expect(event.defaultPrevented).toBe(true);
        expect(openConfirmDialog).toHaveBeenCalledTimes(1);

        vi.mocked(openConfirmDialog).mock.calls[0][0].actions[0].onClick();
        expect(removeTab).toHaveBeenCalledWith("tab-1");
    });

    it("没有改动时放行", () => {
        const {entry} = model();
        tabs.push(closable({dirty: false}));
        __setActiveTab(entry.tab);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("修饰键不匹配时放行", () => {
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "w"}).defaultPrevented).toBe(false);
        expect(keydown({key: "w", ctrlKey: true, shiftKey: true}).defaultPrevented).toBe(false);
        expect(keydown({key: "w", ctrlKey: true, altKey: true}).defaultPrevented).toBe(false);
    });

    it("按住的键重复触发与输入法组合期间不拦", () => {
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "w", ctrlKey: true, repeat: true}).defaultPrevented).toBe(false);
        expect(keydown({key: "w", ctrlKey: true, isComposing: true}).defaultPrevented).toBe(false);
    });

    it("没有活动页签时放行", () => {
        model();
        tabs.push(closable());
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(false);
    });

    it("有聚焦的停靠栏面板时交给思源", () => {
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        const dock = document.createElement("div");
        dock.className = "layout__tab--active sy__file";
        vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({width: 100} as DOMRect);
        document.body.append(dock);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(openConfirmDialog).not.toHaveBeenCalled();
    });

    it("普通停靠栏面板（非 sy__）不阻止关闭页签", () => {
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        const dock = document.createElement("div");
        dock.className = "layout__tab--active";
        vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({width: 100} as DOMRect);
        document.body.append(dock);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(true);
    });

    it("mac 上使用 ⌘W", () => {
        installConfig({system: {os: "darwin"}});
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(keydown({key: "w", metaKey: true}).defaultPrevented).toBe(true);
    });

    it("自定义快捷键 ⌃W 在非 mac 上折算成 Ctrl+W", () => {
        installConfig({keymap: {general: {closeTab: {custom: "⌃W"}}}});
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(true);
    });

    it("⌃D 被思源定义为空快捷键，永不匹配", () => {
        installConfig({keymap: {general: {closeTab: {custom: "⌃D"}}}});
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "d", ctrlKey: true}).defaultPrevented).toBe(false);
    });

    it("没有自定义快捷键时不拦", () => {
        installConfig({keymap: {general: {closeTab: {custom: ""}}}});
        const {entry} = model();
        tabs.push(closable());
        __setActiveTab(entry.tab);
        expect(keydown({key: "w", ctrlKey: true}).defaultPrevented).toBe(false);
    });
});

describe("beforeunload", () => {
    it("有未保存页签时阻止离开", () => {
        tabs.push(closable());
        const event = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("没有未保存页签时放行", () => {
        tabs.push(closable({dirty: false}));
        const event = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it("没有页签时放行", () => {
        const event = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});

describe("移动端", () => {
    it("不注册页签与快捷键监听", () => {
        __setFrontend("mobile");
        const click = vi.spyOn(document, "addEventListener");
        const key = vi.spyOn(window, "addEventListener");
        registerCloseGuard({plugin: plugin as unknown as SiyuanPlugin, t, settings: () => settings});
        expect(click.mock.calls.some(([type]) => type === "click")).toBe(false);
        expect(key.mock.calls.some(([type]) => type === "keydown")).toBe(false);
    });
});

