/**
 * 桌面端的浮层形态。
 *
 * 默认形态是页签（思源的自定义页签），两种情况下改用浮层：设置里把桌面端形态
 * 选成了「浮层」，或者当前前端就是思源弹出的独立窗口（desktop-window）——
 * 那种窗口只有一篇文档的容器、没有页签栏，插件页签在那里落不下来。
 *
 * 挂进来的是同一个视图（view.ts），操作条与页签完全一致，外壳则整个交给思源的对话框：
 * 标题栏（同时是拖动把手，文件名就在那里）、底色、边框、圆角、阴影、可调大小都是它原生的样子。
 * 差别只在关闭路径：
 *
 * - 不放右上角的 × 关闭图标，操作条上也没有关闭按钮；
 * - 关闭只有两条路径：Esc 与点击浮层外的空白，两条都先过 close-guard 的 confirmClose，
 *   有未保存改动时先问保存；
 * - 思源的全局键盘处理会无条件销毁最上层对话框（boot/globalEvent/keydown.ts），
 *   所以 Esc 必须在捕获阶段拦下，否则有未保存改动时能绕过确认直接丢掉浮层。
 */
import {Dialog} from "siyuan";
import {confirmDialogOpen} from "./dialog";
import {confirmClose} from "./unsaved";
import {createView, tabFor, type IEditorTab, type IViewFile} from "./view";
import type {Settings} from "./config";
import type {T} from "./i18n";

export interface IPopupDeps {
    t: T;
    settings: () => Settings;
}

/**
 * 打开一个居中浮层承载编辑器。
 *
 * 同一个文件已经开着时只聚焦，不再叠第二个浮层：两份缓冲会互相覆盖。
 */
export function openPopupEditor(
    deps: IPopupDeps,
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
    // 外观完全交给思源自己的对话框：标题栏、底色、边框、圆角、阴影、可拖动、可调大小都是它给的。
    // 标题栏顺带就是拖动把手，所以文件名放在标题栏里，操作条上不再重复一份。
    // × 关闭图标由 hideCloseIcon 与 disableClose 一起挡掉：关闭要走下面的确认。
    const dialog = new Dialog({
        title,
        width: "80%",
        height: "80%",
        disableClose: true,
        hideCloseIcon: true,
        content: `<div class="editor-siyuan-popup__mount"></div>`,
        destroyCallback: () => {
            window.removeEventListener("keydown", onKeydown, true);
            // 兜底：别的路径（思源的全局 Esc、退出登录之类）直接销毁浮层时也要把视图收干净
            view?.dispose();
            view = undefined;
        },
    });
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container")!;
    // 样式挂在私有类名上（见 index.scss）。Dialog 的 containerClassName 较新，SDK 类型里还没有，
    // 直接打类名就不必抬高 minAppVersion。
    container.classList.add("editor-siyuan-popup");

    /** 关闭：先确认，再销毁。用户取消时什么都不做，浮层留着。 */
    const requestClose = (): void => {
        const target = view;
        if (!target) {
            return;
        }
        confirmClose(target, deps.t, deps.settings, () => {
            view = undefined;
            target.dispose();
            dialog.destroy();
        });
    };

    function onKeydown(event: KeyboardEvent): void {
        // 确认框开着时这一按归它处理，见 dialog.ts 的 confirmDialogOpen
        if (event.key !== "Escape" || event.isComposing || confirmDialogOpen()) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
    }

    window.addEventListener("keydown", onKeydown, true);
    // 点浮层外的空白：宿主在 disableClose 下不会关它，这里自己接上确认
    dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => requestClose());

    const mount = dialog.element.querySelector<HTMLElement>(".editor-siyuan-popup__mount")!;
    // 文件名平时只放在标题栏里，操作条不重复；给了候选文件时操作条上才多一条可点的标题，
    // 那是下拉的触发器。切换文件时两条标题一起改。
    view = createView({
        element: mount,
        data,
        title: files && files.length > 1 ? title : undefined,
        files,
        onSwitch: (file) => {
            const header = dialog.element.querySelector<HTMLElement>(".b3-dialog__header");
            if (header) {
                header.textContent = file.title;
            }
        },
    }, deps.t, deps.settings);
}
