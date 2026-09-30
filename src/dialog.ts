/**
 * 多按钮确认框。
 *
 * 公开 API 的 `confirm()` 只有「取消 / 确认」两个按钮，文案也固定，
 * 而关闭确认需要「保存 / 不保存 / 取消」三选。这里直接拼一个 Dialog，
 * 结构与类名照抄思源的 confirmDialog（b3-dialog__content、b3-dialog__action、
 * b3-button--cancel / b3-button--text / b3-button--remove），
 * 所以外观与思源自己的确认框完全一致，只是按钮文案由调用方给。
 *
 * 默认「可关闭」：点击空白处会退出，退出即等同于取消。需要用户必须点一个按钮时，
 * 把 dismissable 传成 false（见 view.ts 的恢复提示）。
 *
 * 正文支持两种排版标记：换行即换行，`**文字**` 加粗。先转义再套标记，
 * 所以标记只可能出现在插件自己的 i18n 文案里，外部字符串不会因为这两个字符被当成标记。
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

/**
 * 正文排版：转义 → 加粗 → 换行。
 *
 * 加粗放在换行之前，且正则里的点不跨行，所以某一行落单的 `**` 不会把后面几行一起吞掉。
 */
function renderText(text: string): string {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

/**
 * 拦掉 Esc。
 *
 * 思源的全局键盘处理里有一条「无条件销毁最上层对话框」（boot/globalEvent/keydown.ts），
 * 它不看 Dialog 自己的 disableClose，所以必须自己拦。宿主那条是 window 上的冒泡监听，
 * 这里是捕获阶段，先于它执行，stopImmediatePropagation 之后它就不会跑。
 */
function blockEscape(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}

export function openConfirmDialog(options: {
    title: string;
    text: string;
    actions: IDialogAction[];
    /** 次要操作的文案；不传就不渲染这个按钮。 */
    cancelLabel?: string;
    /** 对话框被销毁而用户一个按钮都没点时调用，用于兜底。 */
    onCancel?: () => void;
    /** false 时点击空白处与 Esc 都关不掉，必须点其中一个按钮。 */
    dismissable?: boolean;
}): void {
    const buttons = options.actions.map((action, index) => {
        const modifier = action.danger ? "b3-button--remove" : (action.primary ? "b3-button--text" : "b3-button--cancel");
        return `<div class="fn__space"></div><button class="b3-button ${modifier}" data-action="${index}">${escapeHtml(action.label)}</button>`;
    }).join("");
    const dismissable = options.dismissable !== false;
    const cancelButton = options.cancelLabel
        ? `<button class="b3-button b3-button--cancel" data-action="cancel">${escapeHtml(options.cancelLabel)}</button>`
        : "";
    let handled = false;
    const dialog = new Dialog({
        title: options.title,
        width: "520px",
        content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${renderText(options.text)}</div>
</div>
<div class="b3-dialog__action">
    ${cancelButton}${buttons}
</div>`,
        // disableClose 只挡得住点击空白处（以及移动端的关闭图标），Esc 得靠上面的监听
        disableClose: !dismissable,
        destroyCallback: () => {
            if (!dismissable) {
                window.removeEventListener("keydown", blockEscape, true);
            }
            // 被别的路径销毁、用户没点过按钮时，等同于取消
            if (!handled) {
                options.onCancel?.();
            }
        },
    });
    if (!dismissable) {
        window.addEventListener("keydown", blockEscape, true);
    }
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
