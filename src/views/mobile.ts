/**
 * 移动端的打开入口。
 *
 * 思源的自定义页签 API 在移动端是空实现（宿主的 addTab / openTab 在移动端构建里
 * 被编译掉了），所以同一个视图改挂进一个铺满视口的对话框。除了容器，视图本身
 * 一行都不用改，见 view.ts 的 IViewHost。
 *
 * 关闭只能走操作条上的按钮：点空白与对话框自带的关闭图标都关掉了（disableClose），
 * 否则「有未保存改动」的确认可以被绕过。真正的确认逻辑与页签共用 close-guard.ts 的
 * confirmClose。
 */
import {Dialog} from "siyuan";
import {confirmClose} from "./unsaved";
import {createView, tabFor, type IEditorTab, type IViewFile} from "./view";
import type {Settings} from "../core/config";
import type {T} from "../i18n";

export interface IMobileOpenDeps {
    t: T;
    settings: () => Settings;
}

/**
 * 打开一个铺满视口的编辑器对话框。
 *
 * 同一个文件已经开着时只聚焦，不再叠第二个对话框：两份缓冲会互相覆盖。
 */
export function openMobileEditor(
    deps: IMobileOpenDeps,
    data: {link: string; sy?: boolean; workspace?: boolean},
    title: string,
    files?: IViewFile[],
): void {
    const opened = tabFor(data.link);
    if (opened) {
        opened.focus();
        return;
    }

    let view: IEditorTab | undefined;
    // 文件名放进操作条（见 view.ts），对话框自带的那条标题栏就不要了：
    // 手机上两条栏占地方，而且标题栏是 drag 手柄，拖动会把铺满的对话框拖出屏幕。
    const dialog = new Dialog({
        width: "100%",
        height: "100%",
        disableClose: true,
        hideCloseIcon: true,
        content: `<div class="editor-siyuan-dialog__mount"></div>`,
        destroyCallback: () => {
            // 兜底：思源的全局 Esc 会直接销毁最上层对话框，那条路径也要把视图收干净
            view?.dispose();
            view = undefined;
        },
    });
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container")!;
    // 样式挂在自己的类名上（见 index.scss）。Dialog 的 containerClassName 是较新版本才有的
    // 选项，SDK 类型里还没有，直接打类名就不必抬高 minAppVersion。
    container.classList.add("editor-siyuan-dialog");
    // 没有标题栏，就靠 aria-label 给对话框一个名字
    container.setAttribute("aria-label", title);

    const mount = dialog.element.querySelector<HTMLElement>(".editor-siyuan-dialog__mount")!;
    view = createView({
        element: mount,
        data,
        title,
        files,
        onSwitch: (file) => {
            // 没有标题栏，标题就在操作条上（由视图自己更新），这里只同步给读屏
            container.setAttribute("aria-label", file.title);
        },
        onClose: () => {
            confirmClose(view!, deps.t, deps.settings, () => {
                view?.dispose();
                view = undefined;
                dialog.destroy();
            });
        },
    }, deps.t, deps.settings);
}
