import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Dialog} from "../support/siyuan";
import {makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {confirmClose} from "../../src/views/unsaved";
import {openPopupEditor} from "../../src/views/popup";

const {state} = vi.hoisted(() => ({
    state: {view: undefined as any, existing: undefined as any, confirmOpen: false},
}));

vi.mock("../../src/views/view", () => ({
    createView: vi.fn(() => state.view),
    tabFor: vi.fn(() => state.existing),
}));
vi.mock("../../src/views/unsaved", () => ({confirmClose: vi.fn()}));
vi.mock("../../src/dialogs/dialog", () => ({confirmDialogOpen: vi.fn(() => state.confirmOpen)}));

const t = makeT({});
const settings = makeSettings();
const deps = {t, settings: () => settings};

function fakeView(link = "assets/a.txt"): any {
    return {
        link,
        isDirty: vi.fn(() => true),
        save: vi.fn(async () => true),
        discard: vi.fn(),
        dispose: vi.fn(),
        focus: vi.fn(),
    };
}

const scrim = (dialog: Dialog): HTMLElement => dialog.element.querySelector<HTMLElement>(".b3-dialog__scrim")!;

function escape(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "Escape", cancelable: true});
    window.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    state.existing = undefined;
    state.view = fakeView();
    state.confirmOpen = false;
});

afterEach(() => {
    // 每个用例留下的浮层都要收掉：它们的 Esc 监听挂在 window 上，
    // 留到下一个用例就会抢别人的 Esc（真实使用里浮层关闭时会自己撤掉）。
    for (const dialog of [...Dialog.instances]) {
        dialog.destroy();
    }
});

describe("openPopupEditor", () => {
    it("同一文件已经打开时只聚焦，不再叠第二个浮层", () => {
        state.existing = fakeView();
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        expect(state.existing.focus).toHaveBeenCalledTimes(1);
        expect(Dialog.instances).toHaveLength(0);
    });

    it("建立居中浮层，禁用默认关闭并隐藏自带的关闭图标", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        expect(dialog.options).toMatchObject({
            title: "a.txt",
            width: "80%",
            height: "80%",
            disableClose: true,
            hideCloseIcon: true,
        });
        expect(dialog.options.content).toContain("editor-siyuan-popup__mount");
    });

    it("外观用思源自己的标题栏与容器，只额外挂一个插件类名", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        const header = dialog.element.querySelector<HTMLElement>(".b3-dialog__header")!;
        expect(header.classList.contains("fn__none")).toBe(false);
        expect(header.textContent).toBe("a.txt");
        const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.classList.contains("editor-siyuan-popup")).toBe(true);
    });

    it("视图挂在浮层里，标题交给对话框，操作条不重复", async () => {
        const {createView} = await import("../../src/views/view");
        openPopupEditor(deps, {link: "assets/a.txt", sy: true}, "a.txt");
        const dialog = Dialog.instances[0];
        const mount = dialog.element.querySelector(".editor-siyuan-popup__mount");
        expect(createView).toHaveBeenCalledWith(
            {
                element: mount,
                data: {link: "assets/a.txt", sy: true},
                // 没有候选文件：文件名只在标题栏里，操作条上不重复
                title: undefined,
                files: undefined,
                onSwitch: expect.any(Function),
            },
            t,
            deps.settings,
        );
    });

    it("Esc 先确认，确认后才销毁视图与浮层", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        const event = escape();

        // 宿主那条「无条件销毁最上层对话框」的监听必须被拦下
        expect(event.defaultPrevented).toBe(true);
        expect(confirmClose).toHaveBeenCalledTimes(1);
        const call = vi.mocked(confirmClose).mock.calls[0];
        expect(call[0]).toBe(state.view);
        expect(call[1]).toBe(t);
        expect(call[2]).toBe(deps.settings);
        expect(call[3]).toBeTypeOf("function");
        expect(dialog.destroyed).toBe(false);

        call[3]();
        expect(state.view.dispose).toHaveBeenCalledTimes(1);
        expect(dialog.destroyed).toBe(true);
        expect(dialog.element.isConnected).toBe(false);
    });

    it("点浮层外的空白同样先确认", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        scrim(Dialog.instances[0]).click();
        expect(confirmClose).toHaveBeenCalledTimes(1);
        expect(state.view.dispose).not.toHaveBeenCalled();
    });

    it("用户取消时浮层留着", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        scrim(dialog).click();
        // 什么都没点：confirmClose 的回调不会跑，浮层与视图都还在
        expect(dialog.destroyed).toBe(false);
        expect(state.view.dispose).not.toHaveBeenCalled();
    });

    it("确认框开着时不抢 Esc", () => {
        state.confirmOpen = true;
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const event = escape();
        expect(event.defaultPrevented).toBe(false);
        expect(confirmClose).not.toHaveBeenCalled();
    });

    it("输入法组合期间的 Esc 不管", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const event = new KeyboardEvent("keydown", {key: "Escape", isComposing: true, cancelable: true});
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(confirmClose).not.toHaveBeenCalled();
    });

    it("浮层被别的路径销毁时兜底释放视图，并撤掉 Esc 监听", () => {
        openPopupEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        dialog.destroy();
        expect(state.view.dispose).toHaveBeenCalledTimes(1);

        escape();
        expect(confirmClose).not.toHaveBeenCalled();
    });
});
