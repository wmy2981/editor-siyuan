/**
 * 设置面板。
 *
 * 面板自己拼 Dialog，不用宿主的 Setting，原因有两个，都在移动端 App 上看得出来：
 *
 * - Setting.open() 结尾会把焦点放到面板里第一个 `input, textarea` 上（见宿主
 *   plugin/Setting.ts）。移动端的宿主重写了 HTMLElement.prototype.focus，只要目标是可输入的
 *   控件就调 JSAndroid.showKeyboard()，键盘一弹触发的 adjustResize 会改 WebView 高度、整页重排。
 *   那次 focus 在宿主里，插件关不掉。
 * - Setting 也是先把对话框插进文档，再逐项 insertAdjacentHTML / insertAdjacentElement，
 *   面板的渲染树在入场那一帧里一直在变；容器类名同样没有入口可挂。
 *
 * 所以这里先把整份 DOM 在文档之外拼好，再一次性交给 Dialog，入场之后不再动渲染树，全程不碰
 * focus。容器上的类名见 index.scss（常驻 will-change: transform，预热图层）。
 *
 * 外观仍然全用思源设置页自己的类名：b3-label config-item 是一行、config-name 是标题、
 * b3-label__text 是说明，控件用 b3-switch / b3-select / b3-text-field / b3-button；
 * 底部操作区与宿主一样是 b3-dialog__action + b3-button--cancel / b3-button--text。
 *
 * 面板里改的是一份草稿，点「保存」才落盘。
 */
import {Dialog} from "siyuan";
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

/** 一行设置：标题、说明与控件。 */
interface ISettingRow {
    title: string;
    description: string;
    /** 整行都给控件，标题与说明占上面一块。 */
    wholeRow?: boolean;
    control: HTMLElement;
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

/**
 * 拼一行，结构与宿主 Setting.open() 生成的一致。
 *
 * 开关那一行用 label 包起来，点标题也能切换（与宿主同样的做法）；整行的项（文本域）
 * 把控件放进 fn__block 里，标题与说明在上，控件在下。
 */
function buildRow(row: ISettingRow): HTMLElement {
    const isSwitch = row.control.classList.contains("b3-switch");
    const element = document.createElement(isSwitch ? "label" : "div");
    element.className = row.wholeRow ? "b3-label config-item" : "fn__flex b3-label config-item";

    const title = document.createElement("div");
    title.className = "config-name";
    title.textContent = row.title;
    const description = document.createElement("div");
    description.className = "b3-label__text";
    description.textContent = row.description;

    if (row.wholeRow) {
        const block = document.createElement("div");
        block.className = "fn__block";
        const hr = document.createElement("div");
        hr.className = "fn__hr";
        row.control.classList.add("fn__block");
        block.append(title, hr, description, row.control);
        element.append(block);
        return element;
    }

    const block = document.createElement("div");
    block.className = "fn__flex-1";
    block.append(title, description);
    const space = document.createElement("span");
    space.className = "fn__space";
    row.control.classList.add("fn__flex-center");
    if (!isSwitch) {
        row.control.classList.add("fn__size200");
    }
    element.append(block, space, row.control);
    return element;
}

export function openSettingsPanel(options: ISettingsPanelOptions): void {
    const draft: Settings = {...options.settings};
    const t = options.t;
    const rows: ISettingRow[] = [];

    rows.push({
        title: t("takeover"),
        description: t("takeoverTip"),
        control: switchControl(draft.takeover !== "none", (checked) => {
            draft.takeover = checked ? (draft.takeover === "none" ? "click" : draft.takeover) : "none";
        }),
    });

    // 移动端没有修饰键，能谈的只有单击这一种手势，这一项不显示；
    // 桌面端存下的 Alt/Ctrl 单击在移动端也一律按单击处理（见 open.ts）
    if (!isMobileFrontend()) {
        rows.push({
            title: t("takeoverGesture"),
            description: t("takeoverGestureTip"),
            control: selectControl(draft.takeover === "none" ? "none" : draft.takeover, [
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

    rows.push({
        title: t("previewSy"),
        description: t("previewSyTip"),
        control: switchControl(draft.previewSy, (checked) => {
            draft.previewSy = checked;
        }),
    });

    rows.push({
        title: t("codeBlockMenu"),
        description: t("codeBlockMenuTip"),
        control: switchControl(draft.codeBlockMenu, (checked) => {
            draft.codeBlockMenu = checked;
        }),
    });

    rows.push({
        title: t("extensions"),
        description: t("extensionsTip"),
        wholeRow: true,
        control: (() => {
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
        })(),
    });

    rows.push({
        title: t("maxSize"),
        description: t("maxSizeTip"),
        control: (() => {
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
        })(),
    });

    rows.push({
        title: t("confirmOnClose"),
        description: t("confirmOnCloseTip"),
        control: switchControl(draft.confirmOnClose, (checked) => {
            draft.confirmOnClose = checked;
        }),
    });

    rows.push({
        title: t("stashUnsaved"),
        description: t("stashUnsavedTip"),
        control: switchControl(draft.stashUnsaved, (checked) => {
            draft.stashUnsaved = checked;
        }),
    });

    rows.push({
        title: t("openMode"),
        description: t("openModeTip"),
        control: selectControl(draft.openMode, [
            {value: "edit", label: t("openModeEdit")},
            {value: "preview", label: t("openModePreview")},
        ], (value) => {
            draft.openMode = value as TOpenMode;
        }),
    });

    // 形态只在桌面主窗口里可选：移动端没有页签 API，独立窗口里也没有页签栏，
    // 那两处只能是对话框/浮层，给一个改不动的选项只会让人困惑
    if (!isMobileFrontend() && !isSeparateWindow()) {
        rows.push({
            title: t("desktopForm"),
            description: t("desktopFormTip"),
            control: selectControl(draft.desktopForm, [
                {value: "tab", label: t("desktopFormTab")},
                {value: "dialog", label: t("desktopFormDialog")},
            ], (value) => {
                draft.desktopForm = value as TDesktopForm;
            }),
        });
    }

    rows.push({
        title: t("lineNumbers"),
        description: t("lineNumbersTip"),
        control: selectControl(draft.lineNumbers, [
            {value: "auto", label: t("followSiYuan")},
            {value: "show", label: t("lineNumbersShow")},
            {value: "hide", label: t("disable")},
        ], (value) => {
            draft.lineNumbers = value as TLineNumbers;
        }),
    });

    rows.push({
        title: t("lineWrap"),
        description: t("lineWrapTip"),
        control: selectControl(draft.lineWrap, [
            {value: "auto", label: t("followSiYuan")},
            {value: "on", label: t("enable")},
            {value: "off", label: t("disable")},
        ], (value) => {
            draft.lineWrap = value as TFollow;
        }),
    });

    rows.push({
        title: t("ligatures"),
        description: t("ligaturesTip"),
        control: selectControl(draft.ligatures, [
            {value: "auto", label: t("followSiYuan")},
            {value: "on", label: t("enable")},
            {value: "off", label: t("disable")},
        ], (value) => {
            draft.ligatures = value as TFollow;
        }),
    });

    rows.push({
        title: t("fontSize"),
        description: t("fontSizeTip"),
        control: (() => {
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
        })(),
    });

    rows.push({
        title: t("autocomplete"),
        description: t("autocompleteTip"),
        control: switchControl(draft.autocomplete, (checked) => {
            draft.autocomplete = checked;
        }),
    });

    rows.push({
        title: t("restoreCursor"),
        description: t("restoreCursorTip"),
        control: switchControl(draft.restoreCursor, (checked) => {
            draft.restoreCursor = checked;
        }),
    });

    rows.push({
        title: t("debugMode"),
        description: t("debugModeTip"),
        control: switchControl(draft.debug, (checked) => {
            draft.debug = checked;
        }),
    });

    rows.push({
        title: t("forget"),
        description: t("forgetTip"),
        control: (() => {
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
        })(),
    });

    // 整份 DOM 在这里、在对话框之外拼完。之后只做一次写入，入场帧里渲染树不再变动。
    const content = document.createElement("div");
    content.className = "b3-dialog__content";
    content.append(...rows.map(buildRow));

    const action = document.createElement("div");
    action.className = "b3-dialog__action";
    const cancel = document.createElement("button");
    cancel.className = "b3-button b3-button--cancel";
    cancel.textContent = t("cancel");
    const space = document.createElement("div");
    space.className = "fn__space";
    const save = document.createElement("button");
    save.className = "b3-button b3-button--text";
    save.textContent = t("save");
    action.append(cancel, space, save);

    const dialog = new Dialog({
        title: options.title,
        // 与宿主 Setting 的默认尺寸一致
        width: isMobileFrontend() ? "92vw" : "768px",
        height: "80vh",
        content: "",
    });
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container")!;
    // 样式挂在私有类名上（见 index.scss）。Dialog 的 containerClassName 是较新版本才有的
    // 选项，SDK 类型里还没有，直接打类名就不必抬高 minAppVersion。
    container.classList.add("editor-siyuan-settings");
    dialog.element.querySelector<HTMLElement>(".b3-dialog__body")!.replaceChildren(content, action);

    cancel.addEventListener("click", () => {
        dialog.destroy();
    });
    save.addEventListener("click", () => {
        options.onSave({...draft});
        dialog.destroy();
    });
    // 与宿主的 bindInput 一致：单行输入框里回车等于点保存；文本域里回车是换行
    content.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) {
            return;
        }
        event.preventDefault();
        save.click();
    });
}
