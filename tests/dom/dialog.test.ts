import {describe, expect, it, vi} from "vitest";
import {Dialog} from "../support/siyuan";
import {openConfirmDialog} from "../../src/dialogs/dialog";

const lastDialog = (): Dialog => Dialog.instances[Dialog.instances.length - 1];

function clickAction(element: HTMLElement, action: string): void {
    const button = element.querySelector<HTMLElement>(`[data-action="${action}"]`);
    expect(button, `button ${action}`).not.toBeNull();
    button!.click();
}

describe("openConfirmDialog", () => {
    it("按顺序渲染动作按钮，并按语义选样式", () => {
        openConfirmDialog({
            title: "标题",
            text: "正文",
            actions: [
                {label: "普通", onClick: () => undefined},
                {label: "主操作", primary: true, onClick: () => undefined},
                {label: "危险", danger: true, onClick: () => undefined},
            ],
        });
        const dialog = lastDialog();
        const buttons = Array.from(dialog.element.querySelectorAll(".b3-dialog__action button"));
        expect(buttons.map((button) => button.textContent)).toEqual(["普通", "主操作", "危险"]);
        expect(buttons[0].classList.contains("b3-button--cancel")).toBe(true);
        expect(buttons[1].classList.contains("b3-button--text")).toBe(true);
        expect(buttons[2].classList.contains("b3-button--remove")).toBe(true);
        expect(dialog.options.title).toBe("标题");
    });

    it("没有 cancelLabel 时不渲染取消按钮", () => {
        openConfirmDialog({title: "t", text: "x", actions: [{label: "确定", onClick: () => undefined}]});
        expect(lastDialog().element.querySelector('[data-action="cancel"]')).toBeNull();
    });

    it("有 cancelLabel 时渲染取消按钮", () => {
        openConfirmDialog({
            title: "t",
            text: "x",
            cancelLabel: "取消",
            actions: [{label: "确定", onClick: () => undefined}],
        });
        expect(lastDialog().element.querySelector('[data-action="cancel"]')?.textContent).toBe("取消");
    });

    it("正文先转义再加粗与换行，外部字符串不会被当成标记", () => {
        openConfirmDialog({
            title: "t",
            text: "a < b & c\n**粗体**\n<img src=x>",
            actions: [],
        });
        const body = lastDialog().element.querySelector(".ft__breakword")!;
        expect(body.innerHTML).toBe("a &lt; b &amp; c<br><strong>粗体</strong><br>&lt;img src=x&gt;");
    });

    it("落单的 ** 不会跨行吞掉后面的内容", () => {
        openConfirmDialog({title: "t", text: "**a\nb**", actions: []});
        expect(lastDialog().element.querySelector(".ft__breakword")!.innerHTML).toBe("**a<br>b**");
    });

    it("点击动作按钮：销毁对话框并执行回调", () => {
        const onClick = vi.fn();
        const onCancel = vi.fn();
        openConfirmDialog({
            title: "t",
            text: "x",
            onCancel,
            actions: [{label: "确定", onClick}],
        });
        const dialog = lastDialog();
        clickAction(dialog.element, "0");
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(dialog.destroyed).toBe(true);
        expect(dialog.element.isConnected).toBe(false);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("点击取消按钮：只执行 onCancel", () => {
        const onClick = vi.fn();
        const onCancel = vi.fn();
        openConfirmDialog({
            title: "t",
            text: "x",
            cancelLabel: "取消",
            onCancel,
            actions: [{label: "确定", onClick}],
        });
        const dialog = lastDialog();
        clickAction(dialog.element, "cancel");
        expect(onClick).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(dialog.destroyed).toBe(true);
    });

    it("点击非按钮区域不产生任何动作", () => {
        const onClick = vi.fn();
        const onCancel = vi.fn();
        openConfirmDialog({title: "t", text: "x", onCancel, actions: [{label: "确定", onClick}]});
        const dialog = lastDialog();
        dialog.element.querySelector(".ft__breakword")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(onClick).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
        expect(dialog.destroyed).toBe(false);
    });

    it("非法的 data-action 不产生动作，也不关闭", () => {
        const onCancel = vi.fn();
        openConfirmDialog({title: "t", text: "x", onCancel, actions: [{label: "确定", onClick: () => undefined}]});
        const dialog = lastDialog();
        const fake = document.createElement("button");
        fake.dataset.action = "9";
        dialog.element.append(fake);
        fake.click();
        expect(onCancel).not.toHaveBeenCalled();
        expect(dialog.destroyed).toBe(false);
    });

    it("被别的路径销毁且没点过按钮时按取消处理", () => {
        const onCancel = vi.fn();
        openConfirmDialog({title: "t", text: "x", onCancel, actions: [{label: "确定", onClick: () => undefined}]});
        lastDialog().destroy();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("没有 onCancel 时销毁也不报错", () => {
        openConfirmDialog({title: "t", text: "x", actions: []});
        expect(() => lastDialog().destroy()).not.toThrow();
    });

    it("默认允许点空白关闭（disableClose=false）", () => {
        openConfirmDialog({title: "t", text: "x", actions: []});
        expect(lastDialog().options.disableClose).toBe(false);
    });

    it("dismissable=false 时禁用空白关闭，并拦掉 Esc", () => {
        openConfirmDialog({title: "t", text: "x", actions: [], dismissable: false});
        const dialog = lastDialog();
        expect(dialog.options.disableClose).toBe(true);

        const later = vi.fn();
        window.addEventListener("keydown", later);
        const escape = new KeyboardEvent("keydown", {key: "Escape", cancelable: true});
        window.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(later).not.toHaveBeenCalled();

        const other = new KeyboardEvent("keydown", {key: "Enter", cancelable: true});
        window.dispatchEvent(other);
        expect(other.defaultPrevented).toBe(false);
        expect(later).toHaveBeenCalledTimes(1);
    });

    it("输入法组合期间的 Esc 不拦截", () => {
        openConfirmDialog({title: "t", text: "x", actions: [], dismissable: false});
        const later = vi.fn();
        window.addEventListener("keydown", later);
        const escape = new KeyboardEvent("keydown", {key: "Escape", isComposing: true, cancelable: true});
        window.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(false);
        expect(later).toHaveBeenCalledTimes(1);
    });

    it("对话框销毁后移除 Esc 监听", () => {
        openConfirmDialog({title: "t", text: "x", actions: [], dismissable: false});
        lastDialog().destroy();
        const later = vi.fn();
        window.addEventListener("keydown", later);
        const escape = new KeyboardEvent("keydown", {key: "Escape", cancelable: true});
        window.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(false);
        expect(later).toHaveBeenCalledTimes(1);
    });
});
