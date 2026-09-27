/**
 * 设置面板。
 *
 * 思源的 Setting 类只提供 addItem(title, description, actionElement/createActionElement)，
 * 没有分组、也没有控件类型枚举，任何控件都要自己拼 DOM。这里统一用思源设置页自己的
 * 控件类名：b3-switch（开关）、b3-select（下拉）、b3-text-field（输入框与文本域）、
 * b3-button（按钮），于是外观与「设置」对话框里的其它项完全一致。
 *
 * 面板里改的是一份草稿，点「保存」才落盘——这也正是 Setting 的 confirmCallback 语义。
 */
import {Setting} from "siyuan";
import {DEFAULT_EXTENSIONS, type Settings, type TLineNumbers, type TTakeover} from "./config";
import {rememberedCount} from "./config";
import type {T} from "./i18n";

export interface ISettingsPanelOptions {
    /** 面板标题，用插件的显示名。 */
    title: string;
    t: T;
    settings: Settings;
    onSave: (settings: Settings) => void;
    /** 清除语言、光标位置与暂存的记忆。 */
    onForget: () => void;
}

function switchControl(checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "b3-switch fn__flex-center";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    return input;
}

function selectControl(
    value: string,
    options: {value: string; label: string}[],
    onChange: (value: string) => void,
): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "b3-select fn__flex-center";
    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        select.append(element);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
}

export function openSettingsPanel(options: ISettingsPanelOptions): void {
    const draft: Settings = {...options.settings};
    const t = options.t;
    const setting = new Setting({confirmCallback: () => options.onSave({...draft})});

    setting.addItem({
        title: t("takeover"),
        description: t("takeoverTip"),
        actionElement: switchControl(draft.takeover !== "none", (checked) => {
            draft.takeover = checked ? (draft.takeover === "none" ? "click" : draft.takeover) : "none";
        }),
    });

    setting.addItem({
        title: t("takeoverGesture"),
        description: t("takeoverGestureTip"),
        actionElement: selectControl(draft.takeover === "none" ? "none" : draft.takeover, [
            {value: "click", label: t("gestureClick")},
            {value: "ctrlClick", label: t("gestureCtrlClick")},
            {value: "altClick", label: t("gestureAltClick")},
            {value: "shiftClick", label: t("gestureShiftClick")},
            {value: "none", label: t("gestureNone")},
        ], (value) => {
            draft.takeover = value as TTakeover;
        }),
    });

    setting.addItem({
        title: t("extensions"),
        description: t("extensionsTip"),
        direction: "row",
        createActionElement: () => {
            const textarea = document.createElement("textarea");
            textarea.className = "b3-text-field fn__block";
            textarea.rows = 8;
            textarea.spellcheck = false;
            textarea.value = draft.extensions;
            textarea.addEventListener("input", () => {
                draft.extensions = textarea.value;
            });
            const reset = document.createElement("button");
            reset.className = "b3-button b3-button--outline fn__flex-center";
            reset.textContent = t("extensionsReset");
            reset.addEventListener("click", () => {
                draft.extensions = DEFAULT_EXTENSIONS;
                textarea.value = DEFAULT_EXTENSIONS;
            });
            const wrapper = document.createElement("div");
            wrapper.className = "fn__flex-column editor-siyuan-settings__stack";
            wrapper.append(textarea, reset);
            return wrapper;
        },
    });

    setting.addItem({
        title: t("maxSize"),
        description: t("maxSizeTip"),
        createActionElement: () => {
            const input = document.createElement("input");
            input.type = "number";
            input.className = "b3-text-field fn__flex-center";
            input.min = "0.1";
            input.step = "0.1";
            input.value = String(draft.maxSizeMB);
            input.addEventListener("input", () => {
                const value = Number(input.value);
                if (Number.isFinite(value) && value > 0) {
                    draft.maxSizeMB = value;
                }
            });
            return input;
        },
    });

    setting.addItem({
        title: t("confirmOnClose"),
        description: t("confirmOnCloseTip"),
        actionElement: switchControl(draft.confirmOnClose, (checked) => {
            draft.confirmOnClose = checked;
        }),
    });

    setting.addItem({
        title: t("stashUnsaved"),
        description: t("stashUnsavedTip"),
        actionElement: switchControl(draft.stashUnsaved, (checked) => {
            draft.stashUnsaved = checked;
        }),
    });

    setting.addItem({
        title: t("lineNumbers"),
        description: t("lineNumbersTip"),
        actionElement: selectControl(draft.lineNumbers, [
            {value: "auto", label: t("lineNumbersAuto")},
            {value: "show", label: t("lineNumbersShow")},
            {value: "hide", label: t("lineNumbersHide")},
        ], (value) => {
            draft.lineNumbers = value as TLineNumbers;
        }),
    });

    setting.addItem({
        title: t("restoreCursor"),
        description: t("restoreCursorTip"),
        actionElement: switchControl(draft.restoreCursor, (checked) => {
            draft.restoreCursor = checked;
        }),
    });

    setting.addItem({
        title: t("forget"),
        description: t("forgetTip"),
        createActionElement: () => {
            const button = document.createElement("button");
            button.className = "b3-button b3-button--outline fn__flex-center";
            const label = () => {
                button.textContent = t("forgetButton", {count: rememberedCount()});
            };
            label();
            button.addEventListener("click", () => {
                options.onForget();
                label();
            });
            return button;
        },
    });

    setting.open(options.title);
}
