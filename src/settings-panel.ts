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
import {
    DEFAULT_EXTENSIONS,
    MAX_FONT_SIZE,
    type Settings,
    type TDesktopForm,
    type TFollow,
    type TLineNumbers,
    type TOpenMode,
    type TTakeover,
} from "./config";
import {rememberedCount} from "./config";
import {isMobileFrontend, isSeparateWindow} from "./frontend";
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

    // 移动端没有修饰键，能谈的只有单击这一种手势，这一项不显示；
    // 桌面端存下的 Alt/Ctrl 单击在移动端也一律按单击处理（见 open.ts）
    if (!isMobileFrontend()) {
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
    }

    setting.addItem({
        title: t("previewSy"),
        description: t("previewSyTip"),
        actionElement: switchControl(draft.previewSy, (checked) => {
            draft.previewSy = checked;
        }),
    });

    setting.addItem({
        title: t("codeBlockMenu"),
        description: t("codeBlockMenuTip"),
        actionElement: switchControl(draft.codeBlockMenu, (checked) => {
            draft.codeBlockMenu = checked;
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
        // 输入框外面包一层 div：宿主只给 INPUT/TEXTAREA 类型的控件挂 bindInput，而 bindInput 会
        // focus——数字输入框因此在移动端弹出软键盘。包一层后宿主就管不到它了。桌面端只是这一项
        // 不再自动聚焦，而它本来也不靠回车保存。
        createActionElement: () => {
            const input = document.createElement("input");
            input.type = "number";
            input.className = "b3-text-field";
            input.min = "0.1";
            input.step = "0.1";
            input.value = String(draft.maxSizeMB);
            input.addEventListener("input", () => {
                const value = Number(input.value);
                if (Number.isFinite(value) && value > 0) {
                    draft.maxSizeMB = value;
                }
            });
            const wrapper = document.createElement("div");
            wrapper.className = "editor-siyuan-settings__number";
            wrapper.append(input);
            return wrapper;
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
        title: t("openMode"),
        description: t("openModeTip"),
        actionElement: selectControl(draft.openMode, [
            {value: "edit", label: t("openModeEdit")},
            {value: "preview", label: t("openModePreview")},
        ], (value) => {
            draft.openMode = value as TOpenMode;
        }),
    });

    // 形态只在桌面主窗口里可选：移动端没有页签 API，独立窗口里也没有页签栏，
    // 那两处只能是对话框/浮层，给一个改不动的选项只会让人困惑
    if (!isMobileFrontend() && !isSeparateWindow()) {
        setting.addItem({
            title: t("desktopForm"),
            description: t("desktopFormTip"),
            actionElement: selectControl(draft.desktopForm, [
                {value: "tab", label: t("desktopFormTab")},
                {value: "dialog", label: t("desktopFormDialog")},
            ], (value) => {
                draft.desktopForm = value as TDesktopForm;
            }),
        });
    }

    setting.addItem({
        title: t("lineNumbers"),
        description: t("lineNumbersTip"),
        actionElement: selectControl(draft.lineNumbers, [
            {value: "auto", label: t("followSiYuan")},
            {value: "show", label: t("lineNumbersShow")},
            {value: "hide", label: t("disable")},
        ], (value) => {
            draft.lineNumbers = value as TLineNumbers;
        }),
    });

    setting.addItem({
        title: t("lineWrap"),
        description: t("lineWrapTip"),
        actionElement: selectControl(draft.lineWrap, [
            {value: "auto", label: t("followSiYuan")},
            {value: "on", label: t("enable")},
            {value: "off", label: t("disable")},
        ], (value) => {
            draft.lineWrap = value as TFollow;
        }),
    });

    setting.addItem({
        title: t("ligatures"),
        description: t("ligaturesTip"),
        actionElement: selectControl(draft.ligatures, [
            {value: "auto", label: t("followSiYuan")},
            {value: "on", label: t("enable")},
            {value: "off", label: t("disable")},
        ], (value) => {
            draft.ligatures = value as TFollow;
        }),
    });

    setting.addItem({
        title: t("fontSize"),
        description: t("fontSizeTip"),
        // 与大小上限同样包一层 div：宿主只给裸 INPUT 挂 bindInput，那会 focus 并在移动端弹键盘
        createActionElement: () => {
            const input = document.createElement("input");
            input.type = "number";
            input.className = "b3-text-field";
            input.min = "1";
            input.max = String(MAX_FONT_SIZE);
            input.step = "1";
            input.placeholder = t("followSiYuan");
            input.value = draft.fontSize > 0 ? String(draft.fontSize) : "";
            input.addEventListener("input", () => {
                const value = Number(input.value);
                // 留空即跟随思源；超出范围的按上下限收拢，与 normalizeSettings 一致
                draft.fontSize = Number.isFinite(value) && value > 0
                    ? Math.min(MAX_FONT_SIZE, Math.round(value))
                    : 0;
            });
            const wrapper = document.createElement("div");
            wrapper.className = "editor-siyuan-settings__number";
            wrapper.append(input);
            return wrapper;
        },
    });

    setting.addItem({
        title: t("autocomplete"),
        description: t("autocompleteTip"),
        actionElement: switchControl(draft.autocomplete, (checked) => {
            draft.autocomplete = checked;
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
        title: t("debugMode"),
        description: t("debugModeTip"),
        actionElement: switchControl(draft.debug, (checked) => {
            draft.debug = checked;
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
