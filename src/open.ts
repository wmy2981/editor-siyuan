/**
 * 打开入口。
 *
 * 两条路径，都用思源自己的扩展点：
 *
 * 1. 点击接管：`assets/` 链接的点击会发出可取消的 `open-asset` 事件，
 *    在监听器里 `preventDefault()` 就能顶掉默认的 shell.openPath。
 *    只接管设置里指定的那一个手势，其余手势原样交给思源——
 *    于是 Alt/Shift+单击仍然「使用默认程序打开」，Ctrl+单击仍然「打开文件位置」。
 *
 * 2. 右键菜单：`open-menu-link` 事件里往 detail.menu 加一项，
 *    宿主会把这些项统一包进 id 为 plugin 的「插件」子菜单，
 *    也就是需求里的「菜单 > 插件 > 使用 Editor 打开」。
 *
 * 3. 笔记文档的右键菜单：文件树上的 `open-menu-doctree` 同样由宿主包成
 *    「插件」子菜单，用来只读预览该文档的 .sy 源文件（见 registerSyPreview）。
 *
 * 移动端没有自定义页签，前两条入口改由 mobile.ts 的全屏对话框承载；桌面端把形态选成
 * 浮层（或当前就在思源弹出的独立窗口里）时，改由 popup.ts 的居中浮层承载。
 */
import {
    openTab,
    type App,
    type Custom,
    type IMenu,
    type IMenuBaseDetail,
    type Plugin,
    type subMenu,
} from "siyuan";
import {allowedExtensions, hasAllowedExtension, type Settings, type TTakeover} from "./config";
import {debug} from "./debug";
import {isMobileFrontend, isSeparateWindow} from "./frontend";
import {openMobileEditor} from "./mobile";
import {openPopupEditor} from "./popup";
import {baseName, config, stripQuery} from "./util";
import {fileIcon} from "./file-icon";
import type {T} from "./i18n";
import type {IViewFile} from "./view";

/**
 * 页签类型。
 * openTab 的 custom.id 必须等于「插件名 + 本值」：宿主按这个键找模型工厂，
 * 对不上时页签重启后会被当作「没有对应插件」清掉。
 */
export const TAB_TYPE = "textEditor";

export interface IOpenDeps {
    app: App;
    plugin: Plugin;
    t: T;
    settings: () => Settings;
}

const isMac = (): boolean => config().system?.os === "darwin";

/**
 * 与思源 editor/assetOpen.ts 的 resolveAssetOpenGesture 同义。
 * ctrl 那一档要按平台折算：mac 上是 ⌘，其他平台是 Control。
 */
function gestureOf(event?: MouseEvent): TTakeover {
    if (!event) {
        return "click";
    }
    const ctrl = isMac() ? (event.metaKey && !event.ctrlKey) : (!event.metaKey && event.ctrlKey);
    const count = Number(!!event.altKey) + Number(!!event.shiftKey) + Number(ctrl);
    if (count !== 1) {
        return "click";
    }
    if (event.altKey) {
        return "altClick";
    }
    if (event.shiftKey) {
        return "shiftClick";
    }
    return "ctrlClick";
}

/** 准入判断：必须是 assets 资源，且扩展名在白名单里。 */
function candidate(link: string | null | undefined, settings: Settings): string | undefined {
    if (!link || !link.startsWith("assets/")) {
        return undefined;
    }
    // 去掉 ?box= 之类的查询串后才能当页签键、语言记忆键与暂存键
    return hasAllowedExtension(link, allowedExtensions(settings)) ? stripQuery(link) : undefined;
}

/** 同一个资源已经开着就聚焦它，不再开第二个页签：两份缓冲会互相覆盖。 */
function focusExistingTab(plugin: Plugin, link: string): boolean {
    for (const models of Object.values(plugin.getOpenedTab())) {
        for (const model of models as Custom[]) {
            if (model.data?.link === link) {
                model.tab?.parent?.switchTab(model.tab.headElement, true);
                return true;
            }
        }
    }
    return false;
}

/**
 * 桌面端该用浮层还是页签。
 *
 * 设置里选了浮层就用浮层；另外思源弹出的独立窗口（desktop-window）没有页签栏，
 * 插件页签在那里落不下来，所以那里一律用浮层，与设置无关。
 */
function usesPopup(settings: Settings): boolean {
    return settings.desktopForm === "dialog" || isSeparateWindow();
}

export function openEditor(deps: IOpenDeps, link: string): void {
    if (isMobileFrontend()) {
        // 标题只放文件名：资源链接恒为 assets/<文件名>，带上目录不会增加区分度
        openMobileEditor(deps, {link}, link.slice("assets/".length));
        return;
    }
    if (usesPopup(deps.settings())) {
        debug("open popup", link);
        openPopupEditor(deps, {link}, link.slice("assets/".length));
        return;
    }
    if (focusExistingTab(deps.plugin, link)) {
        debug("open tab: focus the open tab", link);
        return;
    }
    debug("open tab", link);
    void openTab({
        app: deps.app,
        custom: {
            id: deps.plugin.name + TAB_TYPE,
            icon: fileIcon(link),
            // 页签标题只放文件名：资源链接恒为 assets/<文件名>，带上目录不会增加区分度
            title: link.slice("assets/".length),
            data: {link},
        },
    });
}

/**
 * 打开一组文件里的一个，操作条上的标题可以点开下拉切换。
 *
 * 只有需要「在一个窗口里改好几个同类文件」的调用方会用到（比如 prettier 的配置与忽略文件）；
 * 默认的打开入口没有下拉。三种宿主形态都支持：页签、浮层、移动端全屏对话框。
 */
export function openFileList(deps: IOpenDeps, files: IViewFile[], start?: string): void {
    const target = files.find((file) => file.link === start) ?? files[0];
    if (!target) {
        return;
    }
    const data = {link: target.link, workspace: target.workspace, sy: target.sy};
    if (isMobileFrontend()) {
        openMobileEditor(deps, data, target.title, files);
        return;
    }
    if (usesPopup(deps.settings())) {
        debug("open file list in popup", target.link);
        openPopupEditor(deps, data, target.title, files);
        return;
    }
    if (focusExistingTab(deps.plugin, target.link)) {
        debug("open file list: focus the open tab", target.link);
        return;
    }
    debug("open file list in tab", target.link);
    void openTab({
        app: deps.app,
        custom: {
            id: deps.plugin.name + TAB_TYPE,
            icon: fileIcon(target.link),
            title: target.title,
            // 候选表跟着 data 走：宿主重启后由同一份 data 重新 init，下拉因此还在
            data: {...data, files},
        },
    });
}

/** 笔记文档的 .sy 源文件预览：与资源页签同一个页签类型，但只读到底。 */
export function openSyPreview(deps: IOpenDeps, notebookId: string, path: string): void {
    // 落盘位置是 /data/<笔记本ID>/<文档路径>，文档路径形如 /2021….sy
    const apiPath = `/data/${notebookId}${path}`;
    debug("preview .sy", apiPath);
    if (isMobileFrontend()) {
        // 标题取文档名（.sy 文件名就是思源里的文档名），去掉扩展名
        openMobileEditor(deps, {link: apiPath, sy: true}, baseName(path).replace(/\.sy$/i, ""));
        return;
    }
    if (usesPopup(deps.settings())) {
        debug("preview .sy in popup", apiPath);
        openPopupEditor(deps, {link: apiPath, sy: true}, baseName(path).replace(/\.sy$/i, ""));
        return;
    }
    if (focusExistingTab(deps.plugin, apiPath)) {
        debug("preview .sy: focus the open tab");
        return;
    }
    void openTab({
        app: deps.app,
        custom: {
            id: deps.plugin.name + TAB_TYPE,
            icon: fileIcon(apiPath),
            // 页签标题取文档名（.sy 文件名就是思源里的文档名），去掉扩展名
            title: baseName(path).replace(/\.sy$/i, ""),
            data: {link: apiPath, sy: true},
        },
    });
}

/**
 * 在菜单的「插件」子菜单里加一条「预览 .sy 文件」。
 *
 * 两个入口共用：文件树里的笔记文档（open-menu-doctree），以及文档标题图标与面包屑上的
 * 文档按钮（click-editortitleicon，两者都走 protyle/header/openTitleMenu.ts）。
 * 文件夹也会发 open-menu-doctree，且 initFileMenu 把 detail.type 写死成 "doc"，
 * 所以一律靠 .sy 后缀判断。
 */
function addSyPreviewItem(deps: IOpenDeps, menu: subMenu, notebookId: string, path: string): void {
    if (!deps.settings().previewSy || !path.toLowerCase().endsWith(".sy")) {
        return;
    }
    menu.addItem({
        id: "editorSiyuanPreviewSy",
        label: deps.t("previewSyMenu"),
        icon: fileIcon(path),
        click: () => openSyPreview(deps, notebookId, path),
    });
}

/** 笔记文档的右键菜单：文件树、文档标题图标、面包屑上的文档按钮。 */
function registerSyPreview(deps: IOpenDeps): void {
    deps.plugin.eventBus.on("open-menu-doctree", (event) => {
        const item = event.detail.items?.[0];
        debug("open-menu-doctree", {
            type: event.detail.type,
            path: item?.path,
            previewSy: deps.settings().previewSy,
        });
        if (event.detail.type !== "doc" || !item) {
            return;
        }
        addSyPreviewItem(deps, event.detail.menu, item.notebookId, item.path);
    });

    // 标题图标与面包屑的文档按钮：落盘位置由 protyle 自己带着（path 形如 /2021….sy）
    deps.plugin.eventBus.on("click-editortitleicon", (event) => {
        const {notebookId, path} = event.detail.protyle;
        debug("click-editortitleicon", {notebookId, path, previewSy: deps.settings().previewSy});
        if (notebookId && path) {
            addSyPreviewItem(deps, event.detail.menu, notebookId, path);
        }
    });
}

export function registerOpenHandlers(deps: IOpenDeps): void {
    deps.plugin.eventBus.on("open-asset", (event) => {
        const settings = deps.settings();
        const gesture = gestureOf(event.detail.event);
        // 移动端只有单击这一种手势：桌面端存下的 Alt/Ctrl 单击不该让移动端点了没反应
        const takeover = isMobileFrontend() && settings.takeover !== "none" ? "click" : settings.takeover;
        debug("open-asset", {path: event.detail.path, gesture, takeover});
        if (takeover === "none") {
            return;
        }
        const link = candidate(event.detail.path, settings);
        if (!link || gesture !== takeover) {
            debug("open-asset: left to SiYuan", {link, reason: link ? "gesture" : "not whitelisted"});
            return;
        }
        debug("open-asset: take over", link);
        // 同步拦下，默认的 shell.openPath 就不会执行
        event.preventDefault();
        openEditor(deps, link);
    });

    deps.plugin.eventBus.on("open-menu-link", (event: CustomEvent<IMenuBaseDetail>) => {
        const href = event.detail.element?.getAttribute("data-href");
        const link = candidate(href, deps.settings());
        debug("open-menu-link", {href, link});
        if (!link) {
            return;
        }
        const item: IMenu = {
            id: "editorSiyuanOpen",
            label: deps.t("openWithEditor"),
            icon: fileIcon(link),
            click: () => openEditor(deps, link),
        };
        event.detail.menu.addItem(item);
    });

    registerSyPreview(deps);
}
