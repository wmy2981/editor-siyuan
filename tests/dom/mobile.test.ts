import {beforeEach, describe, expect, it, vi} from "vitest";
import {Dialog} from "../support/siyuan";
import {makeSettings} from "../support/env";
import {makeT} from "../../src/i18n";
import {confirmClose} from "../../src/views/unsaved";
import {openMobileEditor} from "../../src/views/mobile";

const {state} = vi.hoisted(() => ({
    state: {view: undefined as any, existing: undefined as any},
}));

vi.mock("../../src/views/view", () => ({
    createView: vi.fn(() => state.view),
    tabFor: vi.fn(() => state.existing),
}));
vi.mock("../../src/views/unsaved", () => ({confirmClose: vi.fn()}));

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

beforeEach(() => {
    state.existing = undefined;
    state.view = fakeView();
});

describe("openMobileEditor", () => {
    it("同一文件已经打开时只聚焦，不再叠对话框", () => {
        state.existing = fakeView();
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        expect(state.existing.focus).toHaveBeenCalledTimes(1);
        expect(Dialog.instances).toHaveLength(0);
    });

    it("建立铺满视口的对话框并隐藏自带关闭入口", () => {
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        expect(dialog.options).toMatchObject({
            width: "100%",
            height: "100%",
            disableClose: true,
            hideCloseIcon: true,
        });
        expect(dialog.options.content).toContain("editor-siyuan-dialog__mount");
    });

    it("给容器加插件类名与 aria-label", () => {
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const container = Dialog.instances[0].element.querySelector<HTMLElement>(".b3-dialog__container")!;
        expect(container.classList.contains("editor-siyuan-dialog")).toBe(true);
        expect(container.getAttribute("aria-label")).toBe("a.txt");
    });

    it("视图挂在对话框里的 mount 上，并带上标题与关闭回调", async () => {
        const {createView} = await import("../../src/views/view");
        openMobileEditor(deps, {link: "assets/a.txt", sy: true}, "a.txt");
        const dialog = Dialog.instances[0];
        const mount = dialog.element.querySelector(".editor-siyuan-dialog__mount");
        expect(createView).toHaveBeenCalledWith(
            expect.objectContaining({
                element: mount,
                data: {link: "assets/a.txt", sy: true},
                title: "a.txt",
                onClose: expect.any(Function),
            }),
            t,
            deps.settings,
        );
    });

    it("关闭按钮先走确认流程，确认后才销毁视图与对话框", async () => {
        const {createView} = await import("../../src/views/view");
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        const host = vi.mocked(createView).mock.calls[0][0];
        host.onClose!();

        expect(confirmClose).toHaveBeenCalledWith(state.view, t, deps.settings, expect.any(Function));
        expect(state.view.dispose).not.toHaveBeenCalled();

        vi.mocked(confirmClose).mock.calls[0][3]();
        expect(state.view.dispose).toHaveBeenCalledTimes(1);
        expect(dialog.destroyed).toBe(true);
        expect(dialog.element.isConnected).toBe(false);
    });

    it("确认后销毁不再重复 dispose", async () => {
        const {createView} = await import("../../src/views/view");
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        const host = vi.mocked(createView).mock.calls[0][0];
        host.onClose!();
        vi.mocked(confirmClose).mock.calls[0][3]();
        // destroy 的兜底回调不应该再拿到已经清空的 view
        expect(state.view.dispose).toHaveBeenCalledTimes(1);
    });

    it("对话框被别的路径销毁时兜底释放视图", async () => {
        openMobileEditor(deps, {link: "assets/a.txt"}, "a.txt");
        const dialog = Dialog.instances[0];
        dialog.destroy();
        expect(state.view.dispose).toHaveBeenCalledTimes(1);
    });
});
