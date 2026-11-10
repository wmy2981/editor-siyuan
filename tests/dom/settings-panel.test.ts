import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Dialog, Plugin, Setting, __setFrontend} from "../support/siyuan";
import {makeSettings} from "../support/env";
import {
    DEFAULT_EXTENSIONS,
    forgetMemories,
    initStore,
    rememberLanguage,
} from "../../src/core/config";
import {makeT} from "../../src/i18n";
import {openSettingsPanel} from "../../src/dialogs/settings-panel";

const labels = {
    takeover: "接管点击",
    takeoverTip: "接管提示",
    takeoverGesture: "手势",
    takeoverGestureTip: "手势提示",
    gestureClick: "单击",
    gestureCtrlClick: "Ctrl 单击",
    gestureAltClick: "Alt 单击",
    gestureShiftClick: "Shift 单击",
    gestureNone: "不接管",
    previewSy: "预览 .sy",
    previewSyTip: "预览提示",
    codeBlockMenu: "代码块菜单",
    codeBlockMenuTip: "代码块菜单提示",
    prettierConfig: "Prettier 配置",
    prettierConfigTip: "配置提示",
    prettierConfigButton: "编辑配置",
    extensions: "扩展名",
    extensionsTip: "扩展名提示",
    extensionsReset: "恢复默认",
    maxSize: "大小上限",
    maxSizeTip: "大小提示",
    confirmOnClose: "关闭确认",
    confirmOnCloseTip: "关闭确认提示",
    stashUnsaved: "暂存",
    stashUnsavedTip: "暂存提示",
    openMode: "打开模式",
    openModeTip: "打开模式提示",
    openModeEdit: "编辑",
    openModePreview: "预览",
    desktopForm: "桌面端形态",
    desktopFormTip: "形态提示",
    desktopFormTab: "页签",
    desktopFormDialog: "浮层",
    lineNumbers: "行号",
    lineNumbersTip: "行号提示",
    lineNumbersShow: "显示",
    followSiYuan: "跟随思源",
    disable: "关闭",
    lineWrap: "换行",
    lineWrapTip: "换行提示",
    enable: "开启",
    ligatures: "连字",
    ligaturesTip: "连字提示",
    highlight: "语法配色",
    highlightTip: "配色提示",
    schemeVsCode: "VS Code",
    schemeGitHub: "GitHub",
    fontSize: "字号",
    fontSizeTip: "字号提示",
    autocomplete: "代码提示",
    autocompleteTip: "代码提示说明",
    restoreCursor: "恢复光标",
    restoreCursorTip: "恢复光标提示",
    debugMode: "调试",
    debugModeTip: "调试提示",
    forget: "清除记忆",
    forgetTip: "清除提示",
    forgetButton: "清除 {count} 条",
    forgetConfirmTitle: "清除确认",
    forgetConfirmBody: "清除提示 {count} 条",
    forgetConfirm: "确认清除",
    cancel: "取消",
};

const t = makeT(labels);

/** 打开面板，返回宿主替身收到的 Setting 与它渲染出来的对话框。 */
function open(overrides: Parameters<typeof makeSettings>[0] = {}) {
    const onSave = vi.fn();
    const onForget = vi.fn();
    const onPrettier = vi.fn();
    openSettingsPanel({title: "文本编辑器", t, settings: makeSettings(overrides), onSave, onForget, onPrettier});
    const setting = Setting.instances[Setting.instances.length - 1];
    const dialog = setting.dialog!;
    const row = (title: string): HTMLElement => {
        const found = Array.from(dialog.element.querySelectorAll<HTMLElement>(".config-item"))
            .find((item) => item.querySelector(".config-name")?.textContent === title);
        if (!found) {
            throw new Error(`没有这一行：${title}`);
        }
        return found;
    };
    /** 行尾那个元素就是控件；整行的项（文本域）与宿主一样挂在 .fn__block 里。 */
    const control = (title: string): HTMLElement => {
        const item = row(title);
        const host = item.classList.contains("fn__flex") ? item : item.querySelector<HTMLElement>(".fn__block")!;
        return host.lastElementChild as HTMLElement;
    };
    const titles = (): Array<string | null> =>
        Array.from(dialog.element.querySelectorAll(".config-name")).map((item) => item.textContent);
    const save = (): void => (dialog.element.querySelector(".b3-button--text") as HTMLButtonElement).click();
    const cancel = (): void => (dialog.element.querySelector(".b3-button--cancel") as HTMLButtonElement).click();
    return {setting, dialog, control, row, titles, save, cancel, onSave, onForget, onPrettier};
}

/** 最后弹出来的对话框：二次确认框。 */
const lastDialog = (): Dialog => Dialog.instances[Dialog.instances.length - 1];

/** 点确认框里的确认按钮（actions[0]）。 */
const confirm = (dialog: Dialog): void =>
    dialog.element.querySelector<HTMLElement>('[data-action="0"]')!.click();

/** 点确认框里的取消按钮。 */
const cancelDialog = (dialog: Dialog): void =>
    dialog.element.querySelector<HTMLElement>('[data-action="cancel"]')!.click();

function toggle(element: HTMLElement, checked: boolean): void {    const input = element as HTMLInputElement;
    input.checked = checked;
    input.dispatchEvent(new Event("change"));
}

function choose(element: HTMLElement, value: string): void {
    const select = element as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("change"));
}

function type(element: HTMLElement, value: string): void {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event("input"));
}

describe("openSettingsPanel", () => {
    beforeEach(async () => {
        await initStore(new Plugin() as unknown as SiyuanPlugin);
    });

    it("用插件显示名打开宿主的面板", () => {
        const {setting, dialog} = open();
        expect(setting.openedName).toBe("文本编辑器");
        expect(dialog.options.title).toBe("文本编辑器");
    });

    it("桌面端声明全部设置项，顺序稳定", () => {
        expect(open().titles()).toEqual([
            labels.takeover,
            labels.takeoverGesture,
            labels.previewSy,
            labels.codeBlockMenu,
            labels.prettierConfig,
            labels.extensions,
            labels.maxSize,
            labels.confirmOnClose,
            labels.stashUnsaved,
            labels.openMode,
            labels.desktopForm,
            labels.lineNumbers,
            labels.lineWrap,
            labels.ligatures,
            labels.highlight,
            labels.fontSize,
            labels.autocomplete,
            labels.restoreCursor,
            labels.debugMode,
            labels.forget,
        ]);
    });

    it("移动端不声明手势选项", () => {
        __setFrontend("mobile");
        const {titles} = open();
        expect(titles()).not.toContain(labels.takeoverGesture);
        expect(titles()).toHaveLength(18);
    });

    it("移动端与独立窗口不声明形态选项", () => {
        __setFrontend("mobile");
        expect(open().titles()).not.toContain(labels.desktopForm);
        __setFrontend("desktop-window");
        expect(open().titles()).not.toContain(labels.desktopForm);
    });

    it("控件是宿主的控件类名，宿主自己摆位置", () => {
        const {control} = open();
        expect(control(labels.takeover).className).toContain("b3-switch");
        expect(control(labels.takeoverGesture).className).toContain("b3-select");
        expect(control(labels.extensions).querySelector("textarea")?.className).toContain("b3-text-field");
        expect(control(labels.forget).className).toContain("b3-button");
        // 数字框直接交给宿主，不再包一层自己的容器
        expect(control(labels.maxSize).tagName).toBe("INPUT");
        expect(control(labels.fontSize).tagName).toBe("INPUT");
    });

    it("扩展名项占整行", () => {
        const {row} = open();
        expect(row(labels.extensions).firstElementChild?.className).toContain("fn__block");
        expect(row(labels.maxSize).firstElementChild?.className).toContain("fn__flex-1");
    });

    it("打开后给面板容器与滚动正文补图层提示", () => {
        const {dialog} = open();
        expect(dialog.element.querySelector(".b3-dialog__container")?.className).toContain("editor-siyuan-settings");
        expect(dialog.element.querySelector(".b3-dialog__content")?.className)
            .toContain("editor-siyuan-settings__content");
    });

    it("移动端打开期间不聚焦输入控件，桌面端保留宿主行为", () => {
        // 移动端宿主重写过 HTMLElement.prototype.focus，落到可输入控件上就会调起软键盘
        __setFrontend("mobile");
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        const mobile = open();
        expect(focus).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(mobile.control(labels.takeover));
        focus.mockRestore();
        // 挡聚焦只在打开期间生效：用户自己点输入框仍然要能聚焦
        const input = mobile.control(labels.maxSize) as HTMLInputElement;
        input.focus();
        expect(document.activeElement).toBe(input);

        __setFrontend("desktop");
        const desktopFocus = vi.spyOn(HTMLElement.prototype, "focus");
        open();
        expect(desktopFocus).toHaveBeenCalled();
        desktopFocus.mockRestore();
    });

    it("宿主原型上的 focus 在打开后被还原", () => {
        __setFrontend("mobile");
        const original = HTMLElement.prototype.focus;
        open();
        expect(HTMLElement.prototype.focus).toBe(original);
    });

    it("改形态会写进保存的设置，但仍不改任何东西直到点保存", () => {
        const {control, save, onSave} = open({desktopForm: "tab"});
        const select = control(labels.desktopForm) as HTMLSelectElement;
        expect(select.value).toBe("tab");
        choose(select, "dialog");
        expect(onSave).not.toHaveBeenCalled();
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({desktopForm: "dialog"}));
    });

    it("配色方案：三选项齐全，默认跟随思源，改后随保存写盘", () => {
        const {control, save, onSave} = open();
        const select = control(labels.highlight) as HTMLSelectElement;
        expect(select.value).toBe("follow");
        expect(Array.from(select.options).map((option) => option.value)).toEqual(["follow", "vscode", "github"]);
        expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
            labels.followSiYuan,
            labels.schemeVsCode,
            labels.schemeGitHub,
        ]);
        choose(select, "vscode");
        expect(onSave).not.toHaveBeenCalled();
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({highlight: "vscode"}));
    });

    it("接管开关：关掉即 none，再打开回到 click", () => {
        const {control, save, onSave} = open({takeover: "altClick"});
        const input = control(labels.takeover);
        toggle(input, false);
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({takeover: "none"}));

        toggle(input, true);
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({takeover: "click"}));
    });

    it("接管开关：本来就是 none 时打开回到 click", () => {
        const {control, save, onSave} = open({takeover: "none"});
        const input = control(labels.takeover) as HTMLInputElement;
        expect(input.checked).toBe(false);
        toggle(input, true);
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({takeover: "click"}));
    });

    it("手势下拉包含五种手势，默认选中当前值", () => {
        const {control} = open({takeover: "shiftClick"});
        const select = control(labels.takeoverGesture) as HTMLSelectElement;
        expect(Array.from(select.options).map((option) => option.value))
            .toEqual(["click", "ctrlClick", "altClick", "shiftClick", "none"]);
        expect(select.value).toBe("shiftClick");
    });

    it("手势下拉改值后保存进草稿", () => {
        const {control, save, onSave} = open();
        choose(control(labels.takeoverGesture), "ctrlClick");
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({takeover: "ctrlClick"}));
    });

    it("布尔开关逐项写入草稿", () => {
        const {control, save, onSave} = open({
            previewSy: false,
            codeBlockMenu: true,
            confirmOnClose: true,
            stashUnsaved: true,
            restoreCursor: true,
            autocomplete: true,
            debug: false,
        });
        toggle(control(labels.previewSy), true);
        toggle(control(labels.codeBlockMenu), false);
        toggle(control(labels.confirmOnClose), false);
        toggle(control(labels.stashUnsaved), false);
        toggle(control(labels.restoreCursor), false);
        toggle(control(labels.autocomplete), false);
        toggle(control(labels.debugMode), true);
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            previewSy: true,
            codeBlockMenu: false,
            confirmOnClose: false,
            stashUnsaved: false,
            restoreCursor: false,
            autocomplete: false,
            debug: true,
        }));
    });

    it("扩展名文本域写入草稿，恢复默认按钮同时更新文本域", () => {
        const {control, save, onSave} = open();
        const wrapper = control(labels.extensions);
        const textarea = wrapper.querySelector("textarea") as HTMLTextAreaElement;
        const reset = wrapper.querySelector("button") as HTMLButtonElement;
        expect(textarea.value).toBe(DEFAULT_EXTENSIONS);

        type(textarea, "txt\nmd");
        reset.click();
        expect(textarea.value).toBe(DEFAULT_EXTENSIONS);
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({extensions: DEFAULT_EXTENSIONS}));
    });

    it("扩展名文本域修改后保存", () => {
        const {control, save, onSave} = open();
        type(control(labels.extensions).querySelector("textarea")!, "txt\nmd");
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({extensions: "txt\nmd"}));
    });

    it("大小上限只接受正数", () => {
        const {control, save, onSave} = open({maxSizeMB: 5});
        const input = control(labels.maxSize) as HTMLInputElement;
        expect(input.type).toBe("number");
        expect(input.min).toBe("0.1");
        expect(input.step).toBe("0.1");

        type(input, "8.5");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));

        type(input, "0");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));

        type(input, "abc");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));
    });

    it("打开模式下拉", () => {
        const {control, save, onSave} = open({openMode: "edit"});
        const select = control(labels.openMode) as HTMLSelectElement;
        expect(Array.from(select.options).map((option) => option.value)).toEqual(["edit", "preview"]);
        choose(select, "preview");
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({openMode: "preview"}));
    });

    it("行号、换行、连字三个下拉的选项与文案", () => {
        const {control} = open();
        const lineNumbers = control(labels.lineNumbers) as HTMLSelectElement;
        const lineWrap = control(labels.lineWrap) as HTMLSelectElement;
        const ligatures = control(labels.ligatures) as HTMLSelectElement;
        expect(Array.from(lineNumbers.options).map((option) => option.value)).toEqual(["auto", "show", "hide"]);
        expect(Array.from(lineNumbers.options).map((option) => option.textContent))
            .toEqual([labels.followSiYuan, labels.lineNumbersShow, labels.disable]);
        expect(Array.from(lineWrap.options).map((option) => option.value)).toEqual(["auto", "on", "off"]);
        expect(Array.from(ligatures.options).map((option) => option.value)).toEqual(["auto", "on", "off"]);
        expect(lineWrap.options[1].textContent).toBe(labels.enable);
    });

    it("三个下拉改值后写入草稿", () => {
        const {control, save, onSave} = open();
        choose(control(labels.lineNumbers), "auto");
        choose(control(labels.lineWrap), "off");
        choose(control(labels.ligatures), "on");
        save();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            lineNumbers: "auto",
            lineWrap: "off",
            ligatures: "on",
        }));
    });

    it("字号只接受正数，留空跟随思源", () => {
        const {control, save, onSave} = open({fontSize: 0});
        const input = control(labels.fontSize) as HTMLInputElement;
        expect(input.type).toBe("number");
        expect(input.value).toBe("");
        expect(input.placeholder).toBe(labels.followSiYuan);

        type(input, "18");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 18}));

        type(input, "0");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 0}));

        type(input, "200");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 72}));

        type(input, "abc");
        save();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 0}));
    });

    it("清除记忆按钮显示条数，确认后调用 onForget 并刷新", async () => {
        rememberLanguage("assets/a.js", "javascript");
        const {control, onForget} = open();
        const button = control(labels.forget) as HTMLButtonElement;
        expect(button.textContent).toBe("清除 1 条");

        onForget.mockImplementation(() => {
            forgetMemories();
        });
        button.click();
        // 先弹二次确认：点按钮本身不清
        expect(onForget).not.toHaveBeenCalled();
        expect(lastDialog().element.textContent).toContain("清除提示 1 条");
        confirm(lastDialog());
        expect(onForget).toHaveBeenCalledTimes(1);
        expect(button.textContent).toBe("清除 0 条");
    });

    it("清除记忆时取消，什么都不清", () => {
        rememberLanguage("assets/a.js", "javascript");
        const {control, onForget} = open();
        const button = control(labels.forget) as HTMLButtonElement;
        button.click();
        cancelDialog(lastDialog());
        expect(onForget).not.toHaveBeenCalled();
        expect(button.textContent).toBe("清除 1 条");
    });

    it("Prettier 配置按钮打开配置编辑器", () => {
        const {control, onPrettier} = open();
        const button = control(labels.prettierConfig) as HTMLButtonElement;
        expect(button.textContent).toBe("编辑配置");
        button.click();
        expect(onPrettier).toHaveBeenCalledTimes(1);
    });

    it("取消不保存", () => {
        const {control, cancel, onSave} = open();
        toggle(control(labels.debugMode), true);
        cancel();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("单行输入框里回车等于点保存，文本域里回车是换行", () => {
        const {control, onSave} = open();
        const input = control(labels.maxSize) as HTMLInputElement;
        type(input, "8");
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({maxSizeMB: 8}));

        onSave.mockClear();
        const textarea = control(labels.extensions).querySelector("textarea")!;
        textarea.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        expect(onSave).not.toHaveBeenCalled();
    });

    it("确认时传出的是一份拷贝，之后的改动不会影响它", () => {
        const {control, save, onSave} = open();
        const button = control(labels.forget) as HTMLButtonElement;
        button.click();
        type(control(labels.extensions).querySelector("textarea")!, "txt");
        save();
        const saved = onSave.mock.calls[0][0];
        expect(saved.extensions).toBe("txt");
        type(control(labels.extensions).querySelector("textarea")!, "md");
        expect(saved.extensions).toBe("txt");
    });

    it("每次打开都新建一份面板与草稿，重开显示当前设置", () => {
        open({debug: false}).dialog;
        expect(Setting.instances).toHaveLength(1);
        const second = open({debug: true});
        expect(Setting.instances).toHaveLength(2);
        expect((second.control(labels.debugMode) as HTMLInputElement).checked).toBe(true);
    });
});
