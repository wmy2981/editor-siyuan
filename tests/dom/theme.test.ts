import {describe, expect, it, vi} from "vitest";
import {Plugin} from "../support/siyuan";
import {installConfig} from "../support/env";
import {applyCodeBlockColors, syncCodeTheme, watchCodeTheme} from "../../src/theme";

const CDN = "/stage/protyle/js/highlight.js/styles";
const LINK_ID = "editor-siyuan-hljsStyle";

function link(): HTMLLinkElement {
    return document.getElementById(LINK_ID) as HTMLLinkElement;
}

function hrefOf(element: HTMLElement): string | null {
    return element.getAttribute("href");
}

function anchor(id: string): HTMLElement {
    const element = document.createElement("link");
    element.id = id;
    document.head.append(element);
    return element;
}

describe("syncCodeTheme", () => {
    it("浅色模式使用 codeBlockThemeLight", () => {
        installConfig({appearance: {mode: 0, codeBlockThemeLight: "atom-one-light"}});
        syncCodeTheme();
        expect(hrefOf(link())).toBe(`${CDN}/atom-one-light.min.css?v=11.12.0`);
        expect(link().rel).toBe("stylesheet");
    });

    it("深色模式使用 codeBlockThemeDark", () => {
        installConfig({appearance: {mode: 1, codeBlockThemeDark: "atom-one-dark"}});
        syncCodeTheme();
        expect(hrefOf(link())).toBe(`${CDN}/atom-one-dark.min.css?v=11.12.0`);
    });

    it("主题名为空时回退到默认主题", () => {
        installConfig({appearance: {mode: 0, codeBlockThemeLight: ""}});
        syncCodeTheme();
        expect(hrefOf(link())).toBe(`${CDN}/default.min.css?v=11.12.0`);

        installConfig({appearance: {mode: 1, codeBlockThemeDark: ""}});
        syncCodeTheme();
        expect(hrefOf(link())).toBe(`${CDN}/github-dark.min.css?v=11.12.0`);
    });

    it("没有锚点时追加到 head 末尾", () => {
        syncCodeTheme();
        expect(document.head.lastElementChild).toBe(link());
    });

    it("思源自己的样式表已存在时插在它前面", () => {
        const siyuan = anchor("protyleHljsStyle");
        syncCodeTheme();
        expect(siyuan.previousElementSibling).toBe(link());
    });

    it("只有 pluginsStyle 时插在它前面", () => {
        const plugins = anchor("pluginsStyle");
        syncCodeTheme();
        expect(plugins.previousElementSibling).toBe(link());
    });

    it("两个锚点都存在时插在思源样式表之前", () => {
        const siyuan = anchor("protyleHljsStyle");
        const plugins = anchor("pluginsStyle");
        syncCodeTheme();
        expect(siyuan.previousElementSibling).toBe(link());
        expect(plugins.previousElementSibling).toBe(siyuan);
    });

    it("重复调用复用同一个 link，不重复插入", () => {
        syncCodeTheme();
        const first = link();
        syncCodeTheme();
        expect(link()).toBe(first);
        expect(document.querySelectorAll(`#${LINK_ID}`)).toHaveLength(1);
    });

    it("主题变化时更新同一个 link 的 href", () => {
        installConfig({appearance: {mode: 1, codeBlockThemeDark: "dark-a"}});
        syncCodeTheme();
        const first = link();
        installConfig({appearance: {mode: 1, codeBlockThemeDark: "dark-b"}});
        syncCodeTheme();
        expect(link()).toBe(first);
        expect(hrefOf(first)).toBe(`${CDN}/dark-b.min.css?v=11.12.0`);
    });

    it("主题名失效时回退到默认主题", () => {
        installConfig({appearance: {mode: 1, codeBlockThemeDark: "missing-theme"}});
        syncCodeTheme();
        const element = link();
        expect(hrefOf(element)).toBe(`${CDN}/missing-theme.min.css?v=11.12.0`);
        element.onerror!(new Event("error"));
        expect(hrefOf(element)).toBe(`${CDN}/github-dark.min.css?v=11.12.0`);
        // 回退主题挂的是「只清空自己」的处理器：再失败一次就彻底放弃
        element.onerror!(new Event("error"));
        expect(hrefOf(element)).toBe(`${CDN}/github-dark.min.css?v=11.12.0`);
        expect(element.onerror).toBeNull();
    });

    it("回退主题本身也失效时不再递归", () => {
        installConfig({appearance: {mode: 0, codeBlockThemeLight: "missing-theme"}});
        syncCodeTheme();
        const element = link();
        element.onerror!(new Event("error"));
        expect(hrefOf(element)).toBe(`${CDN}/default.min.css?v=11.12.0`);
        element.onerror!(new Event("error"));
        expect(element.onerror).toBeNull();
    });

    it("已经是当前主题时不重设 href", () => {
        syncCodeTheme();
        const element = link();
        const setter = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href")?.set;
        expect(setter).toBeDefined();
        const href = hrefOf(element);
        syncCodeTheme();
        expect(hrefOf(element)).toBe(href);
        expect(element.onerror).not.toBeNull();
    });
});

describe("watchCodeTheme", () => {
    it("订阅时立即同步一次", () => {
        const plugin = new Plugin();
        watchCodeTheme(plugin as any);
        expect(link()).not.toBeNull();
    });

    it("setAppearance 事件用事件里的外观对象切换主题", () => {
        const plugin = new Plugin();
        watchCodeTheme(plugin as any);
        installConfig({appearance: {mode: 0, codeBlockThemeLight: "from-config"}});
        plugin.eventBus.emit("ws-main", {
            cmd: "setAppearance",
            data: {mode: 1, codeBlockThemeDark: "from-event"},
        });
        expect(hrefOf(link())).toBe(`${CDN}/from-event.min.css?v=11.12.0`);
    });

    it("忽略其它命令与缺少数值 mode 的事件", () => {
        const plugin = new Plugin();
        watchCodeTheme(plugin as any);
        const before = hrefOf(link());
        plugin.eventBus.emit("ws-main", {cmd: "setConf", data: {mode: 0, codeBlockThemeLight: "ignored"}});
        plugin.eventBus.emit("ws-main", {cmd: "setAppearance", data: {mode: "0", codeBlockThemeLight: "ignored"}});
        plugin.eventBus.emit("ws-main", {cmd: "setAppearance", data: null});
        expect(hrefOf(link())).toBe(before);
    });

    it("mode 为 0 之外的数值都按深色处理", () => {
        const plugin = new Plugin();
        watchCodeTheme(plugin as any);
        plugin.eventBus.emit("ws-main", {cmd: "setAppearance", data: {mode: 2, codeBlockThemeDark: "dark-x"}});
        expect(hrefOf(link())).toBe(`${CDN}/dark-x.min.css?v=11.12.0`);
    });

    it("样式表加载完成后通知调用方重算配色", () => {
        const onLoad = vi.fn();
        const plugin = new Plugin();
        watchCodeTheme(plugin as any, onLoad);
        const element = document.createElement("link");
        element.rel = "stylesheet";
        element.href = `${CDN}/default.min.css`;
        document.head.append(element);
        element.dispatchEvent(new Event("load"));
        expect(onLoad).toHaveBeenCalledTimes(1);
        // 别的元素（脚本、图标之类）不算
        const script = document.createElement("script");
        document.head.append(script);
        script.dispatchEvent(new Event("load"));
        expect(onLoad).toHaveBeenCalledTimes(1);
    });
});

describe("applyCodeBlockColors", () => {
    /** 装一份与思源那份同构的代码块样式：基础色被改写到了 .code-block 上。 */
    function installCodeBlockStyle(color: string, background: string): void {
        const style = document.createElement("style");
        style.textContent = `.protyle-wysiwyg .code-block{color:${color};background:${background}}`;
        document.head.append(style);
    }

    it("跟随思源时取代码块的实际配色", () => {
        installCodeBlockStyle("#444444", "rgb(243, 243, 243)");
        const element = document.createElement("div");
        applyCodeBlockColors(element, true);
        expect(element.style.getPropertyValue("--editor-siyuan-code-color")).toBe("rgb(68, 68, 68)");
        expect(element.style.getPropertyValue("--editor-siyuan-code-background")).toBe("rgb(243, 243, 243)");
        // 探针不留在页面上
        expect(document.querySelector(".protyle-wysiwyg")).toBeNull();
    });

    it("代码块底色是半透明时照抄，和思源里叠在编辑器底色上的效果一致", () => {
        installCodeBlockStyle("#444444", "rgba(27, 31, 35, 0.05)");
        const element = document.createElement("div");
        applyCodeBlockColors(element, true);
        expect(element.style.getPropertyValue("--editor-siyuan-code-background")).toBe("rgba(27, 31, 35, 0.05)");
    });

    it("样式表还没就位时不覆盖已有的值", () => {
        const element = document.createElement("div");
        element.style.setProperty("--editor-siyuan-code-color", "rgb(1, 2, 3)");
        applyCodeBlockColors(element, true);
        expect(element.style.getPropertyValue("--editor-siyuan-code-color")).toBe("rgb(1, 2, 3)");
        expect(element.style.getPropertyValue("--editor-siyuan-code-background")).toBe("");
    });

    it("插件自带的方案把两个属性摘掉，回落到思源编辑器底色", () => {
        installCodeBlockStyle("#444444", "rgb(243, 243, 243)");
        const element = document.createElement("div");
        applyCodeBlockColors(element, true);
        applyCodeBlockColors(element, false);
        expect(element.style.getPropertyValue("--editor-siyuan-code-color")).toBe("");
        expect(element.style.getPropertyValue("--editor-siyuan-code-background")).toBe("");
    });
});
