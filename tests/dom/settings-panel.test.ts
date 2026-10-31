import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Plugin as SiyuanPlugin} from "siyuan";
import {Plugin, Setting, __setFrontend} from "../support/siyuan";
import {makeSettings} from "../support/env";
import {
    DEFAULT_EXTENSIONS,
    forgetMemories,
    initStore,
    rememberLanguage,
} from "../../src/config";
import {makeT} from "../../src/i18n";
import {openSettingsPanel} from "../../src/settings-panel";

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
};

const t = makeT(labels);

function open(overrides: Parameters<typeof makeSettings>[0] = {}) {
    const onSave = vi.fn();
    const onForget = vi.fn();
    openSettingsPanel({title: "文本编辑器", t, settings: makeSettings(overrides), onSave, onForget});
    const setting = Setting.instances[Setting.instances.length - 1];
    const control = (title: string): HTMLElement => setting.controls.get(title)!;
    return {setting, onSave, onForget, control};
}

function toggle(element: HTMLElement, checked: boolean): void {
    const input = element as HTMLInputElement;
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

    it("用插件显示名打开设置面板", () => {
        const {setting} = open();
        expect(setting.opened).toBe(true);
        expect(setting.title).toBe("文本编辑器");
    });

    it("桌面端渲染全部设置项，顺序稳定", () => {
        const {setting} = open();
        expect(setting.items.map((item) => item.title)).toEqual([
            labels.takeover,
            labels.takeoverGesture,
            labels.previewSy,
            labels.codeBlockMenu,
            labels.extensions,
            labels.maxSize,
            labels.confirmOnClose,
            labels.stashUnsaved,
            labels.openMode,
            labels.desktopForm,
            labels.lineNumbers,
            labels.lineWrap,
            labels.ligatures,
            labels.fontSize,
            labels.autocomplete,
            labels.restoreCursor,
            labels.debugMode,
            labels.forget,
        ]);
    });

    it("移动端不渲染手势选项", () => {
        __setFrontend("mobile");
        const {setting} = open();
        expect(setting.items.map((item) => item.title)).not.toContain(labels.takeoverGesture);
        expect(setting.items).toHaveLength(16);
    });

    it("移动端与独立窗口不渲染形态选项", () => {
        __setFrontend("mobile");
        expect(open().setting.items.map((item) => item.title)).not.toContain(labels.desktopForm);
        __setFrontend("desktop-window");
        expect(open().setting.items.map((item) => item.title)).not.toContain(labels.desktopForm);
    });

    it("改形态会写进保存的设置，但仍不改任何东西直到点保存", () => {
        const {control, onSave} = open({desktopForm: "tab"});
        const select = control(labels.desktopForm) as HTMLSelectElement;
        expect(select.value).toBe("tab");
        choose(select, "dialog");
        expect(onSave).not.toHaveBeenCalled();
        settingConfirm(onSave);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({desktopForm: "dialog"}));
    });

    it("扩展名项占整行", () => {
        const {setting} = open();
        expect(setting.items.find((item) => item.title === labels.extensions)?.direction).toBe("row");
    });

    it("控件使用思源的控件类名", () => {
        const {control} = open();
        expect(control(labels.takeover).className).toContain("b3-switch");
        expect(control(labels.takeoverGesture).className).toContain("b3-select");
        expect(control(labels.extensions).querySelector("textarea")?.className).toContain("b3-text-field");
        expect(control(labels.forget).className).toContain("b3-button");
    });

    it("接管开关：关掉即 none，再打开回到 click", () => {
        const {control, onSave} = open({takeover: "altClick"});
        const input = control(labels.takeover) as HTMLInputElement;
        toggle(input, false);
        Setting.instances[Setting.instances.length - 1].confirm();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({takeover: "none"}));

        toggle(input, true);
        Setting.instances[Setting.instances.length - 1].confirm();
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({takeover: "click"}));
    });

    it("接管开关：本来就是 none 时打开回到 click", () => {
        const {control, onSave} = open({takeover: "none"});
        const input = control(labels.takeover) as HTMLInputElement;
        expect(input.checked).toBe(false);
        toggle(input, true);
        settingConfirm(onSave);
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
        const {control, onSave} = open();
        choose(control(labels.takeoverGesture), "ctrlClick");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({takeover: "ctrlClick"}));
    });

    it("布尔开关逐项写入草稿", () => {
        const {control, onSave} = open({
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
        settingConfirm(onSave);
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
        const {control, onSave} = open();
        const wrapper = control(labels.extensions);
        const textarea = wrapper.querySelector("textarea") as HTMLTextAreaElement;
        const reset = wrapper.querySelector("button") as HTMLButtonElement;
        expect(textarea.value).toBe(DEFAULT_EXTENSIONS);

        type(textarea, "txt\nmd");
        reset.click();
        expect(textarea.value).toBe(DEFAULT_EXTENSIONS);
        settingConfirm(onSave);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({extensions: DEFAULT_EXTENSIONS}));
    });

    it("扩展名文本域修改后保存", () => {
        const {control, onSave} = open();
        type(control(labels.extensions).querySelector("textarea")!, "txt\nmd");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({extensions: "txt\nmd"}));
    });

    it("大小上限只接受正数", () => {
        const {control, onSave} = open({maxSizeMB: 5});
        const wrapper = control(labels.maxSize);
        expect(wrapper.className).toBe("editor-siyuan-settings__number");
        const input = wrapper.querySelector("input") as HTMLInputElement;
        expect(input.type).toBe("number");
        expect(input.min).toBe("0.1");
        expect(input.step).toBe("0.1");

        type(input, "8.5");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));

        type(input, "0");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));

        type(input, "abc");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({maxSizeMB: 8.5}));
    });

    it("打开模式下拉", () => {
        const {control, onSave} = open({openMode: "edit"});
        const select = control(labels.openMode) as HTMLSelectElement;
        expect(Array.from(select.options).map((option) => option.value)).toEqual(["edit", "preview"]);
        choose(select, "preview");
        settingConfirm(onSave);
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
        const {control, onSave} = open();
        choose(control(labels.lineNumbers), "auto");
        choose(control(labels.lineWrap), "off");
        choose(control(labels.ligatures), "on");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            lineNumbers: "auto",
            lineWrap: "off",
            ligatures: "on",
        }));
    });

    it("字号只接受正数，留空跟随思源", () => {
        const {control, onSave} = open({fontSize: 0});
        const wrapper = control(labels.fontSize);
        expect(wrapper.className).toBe("editor-siyuan-settings__number");
        const input = wrapper.querySelector("input") as HTMLInputElement;
        expect(input.type).toBe("number");
        expect(input.value).toBe("");
        expect(input.placeholder).toBe(labels.followSiYuan);

        type(input, "18");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 18}));

        type(input, "0");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 0}));

        type(input, "200");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 72}));

        type(input, "abc");
        settingConfirm(onSave);
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({fontSize: 0}));
    });

    it("清除记忆按钮显示条数，点击后调用 onForget 并刷新", async () => {
        rememberLanguage("assets/a.js", "javascript");
        const {control, onForget} = open();
        const button = control(labels.forget) as HTMLButtonElement;
        expect(button.textContent).toBe("清除 1 条");

        onForget.mockImplementation(() => {
            forgetMemories();
        });
        button.click();
        expect(onForget).toHaveBeenCalledTimes(1);
        expect(button.textContent).toBe("清除 0 条");
    });

    it("确认时传出的是一份拷贝，之后的改动不会影响它", () => {
        const {control, onSave} = open();
        const button = control(labels.forget) as HTMLButtonElement;
        button.click();
        type(control(labels.extensions).querySelector("textarea")!, "txt");
        settingConfirm(onSave);
        const saved = onSave.mock.calls[0][0];
        expect(saved.extensions).toBe("txt");
        type(control(labels.extensions).querySelector("textarea")!, "md");
        expect(saved.extensions).toBe("txt");
    });
});

/** 取最近一个面板并触发保存。 */
function settingConfirm(onSave: ReturnType<typeof vi.fn>): void {
    Setting.instances[Setting.instances.length - 1].confirm();
    expect(onSave).toHaveBeenCalled();
}
