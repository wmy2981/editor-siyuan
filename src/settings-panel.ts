/**
 * 设置面板。
 *
 * 面板交给宿主的 Setting：插件只声明每一行（标题、说明、控件），对话框由思源自己拼。
 * 这样对话框的形态就跟着宿主走——桌面端是居中对话框，移动端是宿主的底部抽屉，高度、
 * 拖拽、返回键与键盘避让都由思源统一处理，插件不重复实现。
 *
 * 宿主 Setting 顺带提供这些语义，插件不再自己写：底部「取消 / 保存」按钮、单行输入框里
 * 回车等于点保存、开关整行可点击（开关那一行由宿主包成 label）。
 *
 * 面板里改的是一份草稿，点「保存」才落盘；关掉面板（取消、下拉、Esc、返回键）都不落盘。
 * 每次打开都新建一份 Setting 与一份草稿：Setting 的条目只增不减，控件也在打开时才由
 * createActionElement 现做，只有重开一份新的才能保证面板显示的是当前设置。
 *
 * 移动端的两项处理见 MOBILE_FLICKER：打开期间挡住宿主对可输入控件的自动聚焦（否则弹软
 * 键盘、整页重排），打开后给容器与滚动正文补常驻的 will-change（见 index.scss）。
 */
import {Setting} from "siyuan";
import {
    DEFAULT_EXTENSIONS,
    MAX_FONT_SIZE,
    type Settings,
    type TDesktopForm,
    type TFollow,
    type THighlight,
    type TLineNumbers,
    type TOpenMode,
    type TTakeover,
} from "./config";
import {rememberedCount} from "./config";
import {openConfirmDialog} from "./dialog";
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

/**
 * SDK 的类型声明里还没有 `Setting.dialog`，宿主的实现在 open() 之后暴露它。
 * 只在这里补一个窄类型，不扩散成全局断言；取不到时（更早的宿主）跳过图层提示。
 */
type TSettingWithDialog = Setting & {dialog?: {element: HTMLElement}};

/** 下拉里的一个选项。 */
interface IChoice<V extends string> {
    value: V;
    label: string;
}

function switchControl(checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "b3-switch fn__flex-center";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    return input;
}

function selectControl<V extends string>(
    value: V,
    options: IChoice<V>[],
    onChange: (value: V) => void,
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
    select.addEventListener("change", () => onChange(select.value as V));
    return select;
}

/** 数字输入框；宿主会把它摆在这一行的右端（fn__size200）。 */
function numberControl(input: HTMLInputElement, onInput: (raw: string) => void): HTMLInputElement {
    input.type = "number";
    input.className = "b3-text-field";
    input.addEventListener("input", () => onInput(input.value));
    return input;
}

/**
 * 打开设置面板。
 *
 * 不返回面板对象：关掉的时机与方式由宿主决定，插件只在 confirmCallback 里拿到「已保存」。
 */
export function openSettingsPanel(options: ISettingsPanelOptions): void {
    const draft: Settings = {...options.settings};
    const t = options.t;

    const setting = new Setting({
        // 只在点「保存」时落盘；宿主的其他关闭路径（取消、下拉、Esc、返回键）不会走到这里
        confirmCallback: () => {
            options.onSave({...draft});
        },
    });

    const addSwitch = (title: string, description: string, checked: boolean, apply: (value: boolean) => void): void => {
        setting.addItem({
            title,
            description,
            createActionElement: () => switchControl(checked, apply),
        });
    };

    const addSelect = <V extends string>(
        title: string,
        description: string,
        value: V,
        choices: IChoice<V>[],
        apply: (value: V) => void,
    ): void => {
        setting.addItem({
            title,
            description,
            createActionElement: () => selectControl(value, choices, apply),
        });
    };

    addSwitch(t("takeover"), t("takeoverTip"), draft.takeover !== "none", (checked) => {
        draft.takeover = checked ? (draft.takeover === "none" ? "click" : draft.takeover) : "none";
    });

    // 移动端没有修饰键，能谈的只有单击这一种手势，这一项不显示；
    // 桌面端存下的 Alt/Ctrl 单击在移动端也一律按单击处理（见 open.ts）
    if (!isMobileFrontend()) {
        addSelect(t("takeoverGesture"), t("takeoverGestureTip"),
            draft.takeover === "none" ? "none" : draft.takeover, [
                {value: "click", label: t("gestureClick")},
                {value: "ctrlClick", label: t("gestureCtrlClick")},
                {value: "altClick", label: t("gestureAltClick")},
                {value: "shiftClick", label: t("gestureShiftClick")},
                {value: "none", label: t("gestureNone")},
            ], (value) => {
                draft.takeover = value as TTakeover;
            });
    }

    addSwitch(t("previewSy"), t("previewSyTip"), draft.previewSy, (checked) => {
        draft.previewSy = checked;
    });

    addSwitch(t("codeBlockMenu"), t("codeBlockMenuTip"), draft.codeBlockMenu, (checked) => {
        draft.codeBlockMenu = checked;
    });

    // 文本域占整行（direction: row），下面再挂一个「恢复默认」按钮
    setting.addItem({
        title: t("extensions"),
        description: t("extensionsTip"),
        direction: "row",
        createActionElement: () => {
            const textarea = document.createElement("textarea");
            textarea.className = "b3-text-field";
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
            input.min = "0.1";
            input.step = "0.1";
            input.value = String(draft.maxSizeMB);
            return numberControl(input, (raw) => {
                const value = Number(raw);
                if (Number.isFinite(value) && value > 0) {
                    draft.maxSizeMB = value;
                }
            });
        },
    });

    addSwitch(t("confirmOnClose"), t("confirmOnCloseTip"), draft.confirmOnClose, (checked) => {
        draft.confirmOnClose = checked;
    });

    addSwitch(t("stashUnsaved"), t("stashUnsavedTip"), draft.stashUnsaved, (checked) => {
        draft.stashUnsaved = checked;
    });

    addSelect(t("openMode"), t("openModeTip"), draft.openMode, [
        {value: "edit", label: t("openModeEdit")},
        {value: "preview", label: t("openModePreview")},
    ], (value) => {
        draft.openMode = value as TOpenMode;
    });

    // 形态只在桌面主窗口里可选：移动端没有页签 API，独立窗口里也没有页签栏，
    // 那两处只能是对话框/浮层，给一个改不动的选项只会让人困惑
    if (!isMobileFrontend() && !isSeparateWindow()) {
        addSelect(t("desktopForm"), t("desktopFormTip"), draft.desktopForm, [
            {value: "tab", label: t("desktopFormTab")},
            {value: "dialog", label: t("desktopFormDialog")},
        ], (value) => {
            draft.desktopForm = value as TDesktopForm;
        });
    }

    addSelect(t("lineNumbers"), t("lineNumbersTip"), draft.lineNumbers, [
        {value: "auto", label: t("followSiYuan")},
        {value: "show", label: t("lineNumbersShow")},
        {value: "hide", label: t("disable")},
    ], (value) => {
        draft.lineNumbers = value as TLineNumbers;
    });

    addSelect(t("lineWrap"), t("lineWrapTip"), draft.lineWrap, [
        {value: "auto", label: t("followSiYuan")},
        {value: "on", label: t("enable")},
        {value: "off", label: t("disable")},
    ], (value) => {
        draft.lineWrap = value as TFollow;
    });

    addSelect(t("ligatures"), t("ligaturesTip"), draft.ligatures, [
        {value: "auto", label: t("followSiYuan")},
        {value: "on", label: t("enable")},
        {value: "off", label: t("disable")},
    ], (value) => {
        draft.ligatures = value as TFollow;
    });

    addSelect(t("highlight"), t("highlightTip"), draft.highlight, [
        {value: "follow", label: t("followSiYuan")},
        {value: "vscode", label: t("schemeVsCode")},
        {value: "github", label: t("schemeGitHub")},
    ], (value) => {
        draft.highlight = value as THighlight;
    });

    setting.addItem({
        title: t("fontSize"),
        description: t("fontSizeTip"),
        createActionElement: () => {
            const input = document.createElement("input");
            input.min = "1";
            input.max = String(MAX_FONT_SIZE);
            input.step = "1";
            input.placeholder = t("followSiYuan");
            input.value = draft.fontSize > 0 ? String(draft.fontSize) : "";
            return numberControl(input, (raw) => {
                const value = Number(raw);
                // 留空即跟随思源；超出范围的按上下限收拢，与 normalizeSettings 一致
                draft.fontSize = Number.isFinite(value) && value > 0
                    ? Math.min(MAX_FONT_SIZE, Math.round(value))
                    : 0;
            });
        },
    });

    addSwitch(t("autocomplete"), t("autocompleteTip"), draft.autocomplete, (checked) => {
        draft.autocomplete = checked;
    });

    addSwitch(t("restoreCursor"), t("restoreCursorTip"), draft.restoreCursor, (checked) => {
        draft.restoreCursor = checked;
    });

    addSwitch(t("debugMode"), t("debugModeTip"), draft.debug, (checked) => {
        draft.debug = checked;
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
            // 清空是不可撤销的，而且用户往往是在面板里顺手点的：先问一次
            button.addEventListener("click", () => {
                const count = rememberedCount();
                openConfirmDialog({
                    title: t("forgetConfirmTitle"),
                    text: t("forgetConfirmBody", {count}),
                    cancelLabel: t("cancel"),
                    actions: [
                        {
                            label: t("forgetConfirm"),
                            danger: true,
                            onClick: () => {
                                options.onForget();
                                label();
                            },
                        },
                    ],
                });
            });
            return button;
        },
    });

    openWithFocusGuard(setting, options.title);
    markLayer(setting);
}

/**
 * 打开面板，并在同步流程里挡住宿主对输入控件的自动聚焦。
 *
 * 移动端宿主重写了 HTMLElement.prototype.focus：可输入控件一旦被程序性聚焦就调
 * JSAndroid.showKeyboard()，键盘带起的 adjustResize 会改 WebView 高度、整页重排。
 * 那次聚焦发生在宿主 Setting.open() 里，插件只能在这一段同步调用上临时接管。
 * 只挡 input / textarea，容器等非输入控件照常聚焦；桌面端不动宿主行为。
 */
function openWithFocusGuard(setting: Setting, title: string): void {
    const originalFocus = HTMLElement.prototype.focus;
    const guard = isMobileFrontend();
    if (guard) {
        HTMLElement.prototype.focus = function (this: HTMLElement, focusOptions?: FocusOptions): void {
            if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
                return;
            }
            originalFocus.call(this, focusOptions);
        };
    }
    try {
        setting.open(title);
    } finally {
        if (guard) {
            HTMLElement.prototype.focus = originalFocus;
        }
    }
}

/**
 * 给面板容器与滚动正文补上私有类名（样式见 index.scss）。
 *
 * 两者都常驻 will-change: transform：入场那段 scale / opacity 过渡结束后合成层一被丢掉，
 * App 的 WebView 会提交层不存在时的旧纹理，整屏就是那一帧旧画面。设置面板正文会滚动，
 * 只处理外壳时正文仍会闪，所以两处都要加。
 */
function markLayer(setting: Setting): void {
    const element = (setting as TSettingWithDialog).dialog?.element;
    element?.querySelector(".b3-dialog__container")?.classList.add("editor-siyuan-settings");
    element?.querySelector(".b3-dialog__content")?.classList.add("editor-siyuan-settings__content");
}
