/**
 * 未保存关闭确认。
 *
 * 先说清楚为什么不用生命周期回调：`beforeDestroy` 是同步的、返回值被忽略，
 * 而思源的确认框是异步的，所以在那里做不到「取消关闭」。能取消的只有把关闭动作
 * 拦在它真正发生之前——在捕获阶段收下页签的关闭控件与关闭快捷键，先问用户，
 * 用户点「保存」或「不保存」之后再由我们调用 removeTab 完成关闭。
 *
 * 覆盖的路径：页签 × 按钮、关闭快捷键（默认 ⌘W，用户可改）、双击页签关闭。
 * 页签右键菜单里的关闭项、批量关闭、以及退出思源走的是同一条 removeTab 且没有
 * 可拦截的 DOM 事件，这些路径由 beforeDestroy 的暂存兜底：无论从哪条路径关闭，
 * 未保存的内容都不会静默丢失，下次打开同一文件时会问要不要恢复。
 */
import {getActiveTab, type Custom, type Plugin} from "siyuan";
import {config} from "./util";
import {tabFor, type IEditorTab} from "./view";
import {openConfirmDialog} from "./dialog";
import type {Settings} from "./config";
import type {T} from "./i18n";

export interface ICloseDeps {
    plugin: Plugin;
    t: T;
    settings: () => Settings;
}

const isMac = (): boolean => config().system?.os === "darwin";

/** 与思源 util/keymapBindings.ts 的 normalizeShortcutKey 同义。 */
function normalizeShortcutKey(key: string): string {
    if (isMac() || !key.startsWith("⌃")) {
        return key;
    }
    if (key === "⌃D") {
        return "";
    }
    return key.replace("⌘", "").replace("⌃", "⌘")
        .replace("⌘⇧", "⇧⌘").replace("⌘⌥⇧", "⌥⇧⌘").replace("⌘⌥", "⌥⌘");
}

/** 与思源 protyle/util/hotKey.ts 的 matchAuxiliaryHotKey 同义：只比修饰键。 */
function matchAuxiliaryHotkey(hotkey: string, event: KeyboardEvent): boolean {
    if (hotkey.includes("⌃")) {
        if (!event.ctrlKey) {
            return false;
        }
    } else if (isMac() ? event.ctrlKey : (hotkey.includes("⌘") ? !event.ctrlKey : event.ctrlKey)) {
        return false;
    }
    if (hotkey.includes("⌥") ? !event.altKey : event.altKey) {
        return false;
    }
    if (hotkey.includes("⇧") ? !event.shiftKey : event.shiftKey) {
        return false;
    }
    if (hotkey.includes("⌘")) {
        if (isMac() ? !event.metaKey : !event.ctrlKey) {
            return false;
        }
    } else if (isMac() ? event.metaKey : (hotkey.includes("⌃") ? !event.ctrlKey : event.ctrlKey)) {
        return false;
    }
    return true;
}

/**
 * 思源用 keyCode 查表（Constants.KEYCODELIST）得到主键名，插件拿不到那张表，
 * 这里按同一套符号自己归一化。冷门键位（Pause、CapsLock 之类）对不上时不拦截，
 * 改由暂存兜底，不会丢内容，只是少了「取消关闭」这一步。
 */
const KEY_NAMES: Record<string, string> = {
    " ": " ",
    "Tab": "⇥",
    "Backspace": "⌫",
    "Delete": "⌦",
    "Insert": "Insert",
    "Enter": "↩",
    "Escape": "Escape",
    "PageUp": "PageUp",
    "PageDown": "PageDown",
    "Home": "Home",
    "End": "End",
    "ArrowLeft": "←",
    "ArrowUp": "↑",
    "ArrowRight": "→",
    "ArrowDown": "↓",
    "CapsLock": "CapsLock",
    "Pause": "Pause",
    "PrintScreen": "PrintScreen",
};

const keyNameOf = (event: KeyboardEvent): string => {
    const key = event.key;
    if (key in KEY_NAMES) {
        return KEY_NAMES[key];
    }
    return key.length === 1 ? key.toUpperCase() : key;
};

function matchesHotkey(hotkey: string, event: KeyboardEvent): boolean {
    const normalized = normalizeShortcutKey(hotkey);
    if (!normalized) {
        return false;
    }
    let index = 0;
    while (index < normalized.length && "⌃⌥⇧⌘".includes(normalized[index])) {
        index++;
    }
    const mainKey = normalized.slice(index);
    if (mainKey === "" || mainKey !== keyNameOf(event)) {
        return false;
    }
    return matchAuxiliaryHotkey(normalized, event);
}

/** 页签 id → 我们自己的编辑器视图。 */
function viewForTabId(plugin: Plugin, tabId: string | null | undefined): IEditorTab | undefined {
    if (!tabId) {
        return undefined;
    }
    for (const models of Object.values(plugin.getOpenedTab())) {
        for (const model of models as Custom[]) {
            if (model.tab?.id === tabId) {
                return tabFor(String(model.data?.link ?? ""));
            }
        }
    }
    return undefined;
}

/** 关闭页签。捕获阶段把原生事件拦下之后，关闭要由我们自己发起。 */
function closeTabById(plugin: Plugin, tabId: string): void {
    for (const models of Object.values(plugin.getOpenedTab())) {
        for (const model of models as Custom[]) {
            if (model.tab?.id === tabId) {
                model.tab.parent?.removeTab(model.tab.id);
                return;
            }
        }
    }
}

export function registerCloseGuard(deps: ICloseDeps): void {
    const guard = (view: IEditorTab, proceed: () => void): void => {
        if (!view.isDirty() || !deps.settings().confirmOnClose) {
            proceed();
            return;
        }
        openConfirmDialog({
            title: deps.t("closeTitle"),
            text: deps.t("closeBody", {file: view.link.slice("assets/".length)}),
            cancelLabel: deps.t("cancel"),
            onCancel: () => {
                // 取消：默认行为已经被拦下，什么都不做即可
            },
            actions: [
                {
                    label: deps.t("closeDiscard"),
                    danger: true,
                    onClick: () => {
                        view.discard();
                        proceed();
                    },
                },
                {
                    label: deps.t("save"),
                    primary: true,
                    onClick: () => {
                        void view.save().then((ok) => {
                            if (ok) {
                                proceed();
                            }
                        });
                    },
                },
            ],
        });
    };

    // 页签关闭控件与双击页签：宿主的监听挂在冒泡阶段，捕获阶段必然先到这里
    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const tabElement = target?.closest?.<HTMLElement>('[data-type="tab-header"][data-id]');
        if (!tabElement) {
            return;
        }
        const byCloseButton = Boolean(target?.closest?.(".item__close"));
        const byDoubleClick = event.detail > 1 && config().fileTree.closeTabOnDoubleClick;
        if (!byCloseButton && !byDoubleClick) {
            return;
        }
        const tabId = tabElement.getAttribute("data-id");
        const view = viewForTabId(deps.plugin, tabId);
        if (!view || !view.isDirty() || !deps.settings().confirmOnClose) {
            // 没有未保存的改动就照常放行
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        guard(view, () => closeTabById(deps.plugin, tabId!));
    }, true);

    // 关闭快捷键。思源的 keydown 挂在 window 的冒泡阶段，捕获阶段必然先到这里
    window.addEventListener("keydown", (event) => {
        if (event.repeat || event.isComposing) {
            return;
        }
        const hotkey = config().keymap.general?.closeTab?.custom ?? "";
        if (!matchesHotkey(hotkey, event)) {
            return;
        }
        // 思源的 closeTab 会先看有没有聚焦中的停靠栏面板（.layout__tab--active 只加给
        // 带 sy__ 前缀的 dock），有就关面板而不是关页签。那种情况不归我们管，照原样放行。
        const activePanel = document.querySelector<HTMLElement>(".layout__tab--active");
        if (activePanel && activePanel.getBoundingClientRect().width > 0 &&
            Array.from(activePanel.classList).some((name) => name.startsWith("sy__"))) {
            return;
        }
        const tab = getActiveTab();
        const view = viewForTabId(deps.plugin, tab?.id);
        if (!view || !view.isDirty() || !deps.settings().confirmOnClose) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        guard(view, () => tab.parent?.removeTab(tab.id));
    }, true);
}
