/**
 * 编辑器右键菜单。
 *
 * 用的是思源给插件的那套 Menu（宿主 src/plugin/Menu.ts）：它直接操作宿主的
 * #commonMenu 元素，弹出来的就是思源自己的 .b3-menu——圆角、阴影、分组圆角、
 * 悬停色、快捷键提示、图标线宽全部由宿主负责，插件这边一行样式都不用写。
 *
 * 为什么不直接复用思源编辑器的右键菜单：那套菜单挂在 ProseMirror 的
 * open-menu-content 事件上，只对思源自己的块级选区触发；本插件的正文是
 * CodeMirror，拿不到那个事件。思源对纯文本输入框的右键则是转给 Electron
 * 主进程弹系统菜单（宿主 src/menus/index.ts），插件也没有那条通道。
 * 所以这里用官方给的 Menu，菜单项、图标、快捷键对齐思源自己的编辑器菜单
 * （宿主 src/menus/protyle.ts）：剪切 / 复制 / 粘贴 / 全选、撤销 / 重做，
 * 剪贴板动作同样走 document.execCommand——思源自己也是这么实现的。
 *
 * 搜索面板里的输入框不拦：那些是 b3-text-field，宿主会把它们的右键
 * 转成 Electron 原生菜单（带拼写检查），比插件自制的更原生。
 */
import {Menu, showMessage} from "siyuan";
import {redo, redoDepth, selectAll, undo, undoDepth} from "@codemirror/commands";
import {openSearchPanel} from "@codemirror/search";
import type {EditorView} from "@codemirror/view";
import {ICON_SAVE} from "./icons";
import {config} from "./util";
import type {T} from "./i18n";

export interface IMenuDeps {
    view: EditorView;
    t: T;
    /** 预览模式：不提供会改动文档的菜单项。 */
    readOnly: boolean;
    onSave: () => void;
}

/**
 * 剪贴板动作。
 * execCommand 作用在「当前有焦点的可编辑元素」上，所以先把焦点交回编辑器。
 */
const clipboard = (view: EditorView, command: "cut" | "copy"): void => {
    view.focus();
    document.execCommand(command);
};

/** 桌面端 execCommand("paste") 可用；真拿不到时退回异步剪贴板。 */
const paste = (view: EditorView, t: T): void => {
    view.focus();
    if (document.execCommand("paste")) {
        return;
    }
    if (typeof navigator.clipboard === "undefined") {
        showMessage(t("pasteFailed"), 3000, "error");
        return;
    }
    void navigator.clipboard.readText().then((text) => {
        if (text) {
            view.dispatch(view.state.replaceSelection(text));
        }
    }).catch(() => {
        showMessage(t("pasteFailed"), 3000, "error");
    });
};

export function openEditorMenu(deps: IMenuDeps, x: number, y: number): void {
    const {view, t, readOnly} = deps;
    // 重做的按键跟随 CodeMirror 的 historyKeymap：mac 是 ⇧⌘Z，其他平台是 Ctrl+Y
    const redoKey = config().system?.os === "darwin" ? "⇧⌘Z" : "⌘Y";
    const menu = new Menu();

    // 与思源一致：没有选区就不给剪切、复制
    const hasSelection = !view.state.selection.main.empty;
    if (hasSelection && !readOnly) {
        menu.addItem({id: "cut", icon: "iconCut", label: t("cut"), accelerator: "⌘X", click: () => clipboard(view, "cut")});
    }
    if (hasSelection) {
        menu.addItem({id: "copy", icon: "iconCopy", label: t("copy"), accelerator: "⌘C", click: () => clipboard(view, "copy")});
    }
    if (!readOnly) {
        menu.addItem({id: "paste", icon: "iconPaste", label: t("paste"), accelerator: "⌘V", click: () => paste(view, t)});
    }
    menu.addItem({
        id: "selectAll",
        icon: "iconSelectAll",
        label: t("selectAll"),
        accelerator: "⌘A",
        // 菜单项被移除后焦点会掉到 body 上，先交回编辑器再执行
        click: () => {
            view.focus();
            selectAll(view);
        },
    });

    menu.addSeparator();
    menu.addItem({
        id: "undo",
        icon: "iconUndo",
        label: t("undo"),
        accelerator: "⌘Z",
        disabled: readOnly || undoDepth(view.state) === 0,
        click: () => {
            view.focus();
            undo(view);
        },
    });
    menu.addItem({
        id: "redo",
        icon: "iconRedo",
        label: t("redo"),
        accelerator: redoKey,
        disabled: readOnly || redoDepth(view.state) === 0,
        click: () => {
            view.focus();
            redo(view);
        },
    });

    menu.addSeparator();
    menu.addItem({id: "find", icon: "iconSearch", label: t("find"), accelerator: "⌘F", click: () => openSearchPanel(view)});

    menu.addSeparator();
    menu.addItem({id: "save", icon: ICON_SAVE, label: t("save"), accelerator: "⌘S", disabled: readOnly, click: () => deps.onSave()});

    menu.open({x, y});
}
