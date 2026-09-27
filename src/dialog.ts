/**
 * 多按钮确认框。
 *
 * 公开 API 的 `confirm()` 只有「取消 / 确认」两个按钮，文案也固定，
 * 而关闭确认需要「保存 / 不保存 / 取消」三选。这里直接拼一个 Dialog，
 * 结构与类名照抄思源的 confirmDialog（b3-dialog__content、b3-dialog__action、
 * b3-button--cancel / b3-button--text / b3-button--remove），
 * 所以外观与思源自己的确认框完全一致，只是按钮文案由调用方给。
 */
import {Dialog} from "siyuan";
import {escapeHtml} from "./util";

export interface IDialogAction {
    label: string;
    /** 主操作，用思源的强调按钮样式。 */
    primary?: boolean;
    /** 破坏性操作，用思源的删除按钮样式。 */
    danger?: boolean;
    onClick: () => void;
}

export function openConfirmDialog(options: {
    title: string;
    text: string;
    actions: IDialogAction[];
    cancelLabel: string;
    onCancel?: () => void;
}): void {
    const buttons = options.actions.map((action, index) => {
        const modifier = action.danger ? "b3-button--remove" : (action.primary ? "b3-button--text" : "b3-button--cancel");
        return `<div class="fn__space"></div><button class="b3-button ${modifier}" data-action="${index}">${escapeHtml(action.label)}</button>`;
    }).join("");
    let handled = false;
    const dialog = new Dialog({
        title: options.title,
        width: "520px",
        content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${escapeHtml(options.text)}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="cancel">${escapeHtml(options.cancelLabel)}</button>${buttons}
</div>`,
        destroyCallback: () => {
            // 用 X 或 Escape 关闭等同于取消
            if (!handled) {
                options.onCancel?.();
            }
        },
    });
    dialog.element.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (!target) {
            return;
        }
        const value = target.dataset.action;
        const action = value === "cancel" ? undefined : options.actions[Number(value)];
        if (!action && value !== "cancel") {
            return;
        }
        handled = true;
        dialog.destroy();
        if (action) {
            action.onClick();
        } else {
            options.onCancel?.();
        }
    });
}
