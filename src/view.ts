/**
 * 页签内的编辑器视图。
 *
 * 外观不再照搬代码块：代码块是「嵌在正文里的一块卡片」，自带背景与操作条，
 * 而这里是一整个页签，背景应当跟随思源编辑器背景（深色浅色各用各的），
 * 所以外壳用插件自己的类名，颜色全部取自思源的 CSS 变量
 * （--b3-theme-background / --b3-theme-on-background / --b3-font-family-editor-code
 * / --b3-font-size-editor / --b3-border-color / --b3-list-hover）。
 * 语法配色仍然复用用户选定的那份 hljs 主题样式表，见 theme.ts。
 *
 * 顶部一条操作条：左侧是可点的语言标签，右侧依次是查找、只读切换与保存。
 * 图标按钮用 .ariaLabel + data-position，与思源自己的图标按钮同一套提示机制。
 */
import {showMessage, type Custom} from "siyuan";
import {openSearchPanel} from "@codemirror/search";
import type {EditorView} from "@codemirror/view";
import {readAssetText, resolveAsset, writeAssetText, type IAssetRef, type IAssetText} from "./asset";
import {
    createEditor,
    readCursor,
    restoreCursor,
    setEditorLanguage,
    setEditorLineNumbers,
    setEditorReadOnly,
} from "./editor";
import {
    dropStash,
    putStash,
    rememberedCursor,
    rememberedLanguage,
    rememberCursor,
    rememberLanguage,
    stashedEntry,
    type Settings,
} from "./config";
import {guessLanguage, PLAIN_TEXT} from "./language";
import {loadHljs} from "./hljs";
import {openLanguageMenu} from "./language-menu";
import {openConfirmDialog} from "./dialog";
import {openEditorMenu} from "./context-menu";
import {ICON_SAVE} from "./icons";
import {config, escapeHtml} from "./util";
import type {T} from "./i18n";

export interface IEditorTab {
    readonly link: string;
    readonly element: HTMLElement;
    /** 有未保存的改动。 */
    isDirty(): boolean;
    /** 写回原文件；成功返回 true。 */
    save(): Promise<boolean>;
    /** 放弃未保存的改动，用于「不保存」关闭。 */
    discard(): void;
    /** 设置里改过行号偏好后，对已打开的页签立即生效。 */
    setLineNumbers(show: boolean): void;
    /** 页签销毁：记光标、暂存未保存内容、释放编辑器。 */
    dispose(): void;
    focus(): void;
}

const registry = new Set<IEditorTab>();
let focused: IEditorTab | undefined;

export const allTabs = (): IEditorTab[] => Array.from(registry);
export const tabFor = (link: string): IEditorTab | undefined =>
    Array.from(registry).find((item) => item.link === link);
/** 命令的目标页签：优先当前有焦点的，没有则取最后注册的一个。 */
export const focusedTab = (): IEditorTab | undefined => {
    if (focused && registry.has(focused)) {
        return focused;
    }
    const tabs = allTabs();
    return tabs[tabs.length - 1];
};

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function createView(custom: Custom, t: T, settings: () => Settings): IEditorTab {
    const link = String(custom.data?.link ?? "");

    const root = document.createElement("div");
    root.className = "editor-siyuan";
    root.innerHTML = `<div class="editor-siyuan__action">
<span class="editor-siyuan__language"></span>
<span class="fn__flex-1"></span>
<span class="ariaLabel editor-siyuan__icon" data-position="4north" data-type="search"><svg><use xlink:href="#iconSearch"></use></svg></span>
<span class="ariaLabel editor-siyuan__icon" data-position="4north" data-type="readonly"><svg><use xlink:href="#iconEye"></use></svg></span>
<span class="ariaLabel editor-siyuan__icon" data-position="4north" data-type="save"><svg><use xlink:href="#${ICON_SAVE}"></use></svg></span>
</div>
<div class="editor-siyuan__body">
<div class="editor-siyuan__mount"></div>
</div>`;

    const mount = root.querySelector<HTMLElement>(".editor-siyuan__mount")!;
    const languageLabel = root.querySelector<HTMLElement>(".editor-siyuan__language")!;
    const searchIcon = root.querySelector<HTMLElement>('[data-type="search"]')!;
    const saveIcon = root.querySelector<HTMLElement>('[data-type="save"]')!;
    const readonlyIcon = root.querySelector<HTMLElement>('[data-type="readonly"]')!;

    let ref: IAssetRef | undefined;
    let editor: EditorView | undefined;
    let dirty = false;
    let readOnly = false;
    let language = PLAIN_TEXT;
    let eol: "\n" | "\r\n" = "\n";
    let bom = false;
    let disposed = false;

    const placeholder = (text: string, isError = false): void => {
        mount.innerHTML = `<div class="editor-siyuan__placeholder${isError ? " editor-siyuan__placeholder--error" : ""}">${escapeHtml(text)}</div>`;
    };

    /** 行号是否显示：auto 跟随思源的 editor.codeSyntaxHighlightLineNum。 */
    const lineNumbersWanted = (): boolean => {
        const preference = settings().lineNumbers;
        return preference === "show" ||
            (preference === "auto" && config().editor.codeSyntaxHighlightLineNum);
    };

    const syncIcons = (): void => {
        searchIcon.setAttribute("aria-label", t("find"));
        saveIcon.setAttribute("aria-label", dirty ? t("saveDirty") : t("save"));
        saveIcon.classList.toggle("editor-siyuan__icon--dirty", dirty);
        readonlyIcon.setAttribute("aria-label", readOnly ? t("switchToEdit") : t("switchToPreview"));
        readonlyIcon.innerHTML = `<svg><use xlink:href="#${readOnly ? "iconEdit" : "iconEye"}"></use></svg>`;
        // 空标签会被思源自己的 CSS 补上 "language"，加载完成前保持空
        languageLabel.textContent = editor ? language : "";
        languageLabel.setAttribute("aria-label", t("languageLabel"));
    };

    const save = async (): Promise<boolean> => {
        if (!ref || !editor) {
            return false;
        }
        if (readOnly) {
            showMessage(t("readonlyEditor"));
            return false;
        }
        const error = await writeAssetText(ref, {text: editor.state.doc.toString(), eol, bom});
        if (error) {
            showMessage(`${t("saveFailed")}: ${error}`, 6000, "error");
            return false;
        }
        dirty = false;
        dropStash(ref.link);
        syncIcons();
        showMessage(t("saved"), 2000);
        return true;
    };

    const tab: IEditorTab = {
        link,
        element: root,
        isDirty: () => dirty,
        save,
        discard: () => {
            dirty = false;
            dropStash(link);
            syncIcons();
        },
        setLineNumbers: (show: boolean) => {
            if (editor) {
                setEditorLineNumbers(editor, show);
            }
        },
        dispose: () => {
            disposed = true;
            if (editor) {
                if (settings().restoreCursor) {
                    rememberCursor(link, readCursor(editor));
                }
                if (dirty && ref && settings().stashUnsaved) {
                    putStash(link, {text: editor.state.doc.toString(), eol, bom, at: Date.now()});
                }
                editor.destroy();
                editor = undefined;
            }
            registry.delete(tab);
            if (focused === tab) {
                focused = undefined;
            }
            root.remove();
        },
        focus: () => {
            editor?.focus();
        },
    };

    root.addEventListener("focusin", () => {
        focused = tab;
    });
    saveIcon.addEventListener("click", () => {
        void save();
    });
    searchIcon.addEventListener("click", () => {
        if (editor) {
            openSearchPanel(editor);
        }
    });
    readonlyIcon.addEventListener("click", () => {
        readOnly = !readOnly;
        if (editor) {
            setEditorReadOnly(editor, readOnly);
        }
        syncIcons();
    });
    languageLabel.addEventListener("click", () => {
        openLanguageMenu(languageLabel, language, t, (picked) => {
            language = picked;
            if (editor) {
                setEditorLanguage(editor, picked);
            }
            rememberLanguage(link, picked);
            syncIcons();
        });
    });

    registry.add(tab);
    custom.element.append(root);
    syncIcons();
    placeholder(t("loading"));

    void (async () => {
        if (config().readonly) {
            placeholder(t("workspaceReadonly"), true);
            return;
        }
        const resolved = await resolveAsset(link);
        if (disposed) {
            return;
        }
        if (resolved.kind === "error") {
            placeholder(t("openFailed", {message: resolved.message}), true);
            return;
        }
        ref = resolved.ref;
        if (ref.size > settings().maxSizeMB * 1024 * 1024) {
            placeholder(t("tooLarge", {size: megabytes(ref.size), limit: settings().maxSizeMB}), true);
            return;
        }
        let data: IAssetText;
        try {
            data = await readAssetText(ref);
        } catch (error) {
            placeholder(t("openFailed", {message: error instanceof Error ? error.message : String(error)}), true);
            return;
        }
        if (disposed) {
            return;
        }
        eol = data.eol;
        bom = data.bom;
        language = rememberedLanguage(ref.link) ?? guessLanguage(ref.link);
        const stashed = settings().stashUnsaved ? stashedEntry(ref.link) : undefined;
        const doc = stashed && stashed.text !== data.text
            ? await askRestore(stashed.text, data.text, t)
            : data.text;
        if (disposed) {
            return;
        }
        dirty = doc !== data.text;
        // 高亮引擎没就绪就直接建编辑器的话，首次渲染会是无色的，
        // 而 StateField 只在文档变化时才重算，用户要敲一下才会看到颜色。
        await loadHljs();
        if (disposed) {
            return;
        }
        mount.innerHTML = "";
        editor = createEditor(mount, {
            doc,
            language,
            readOnly,
            showLineNumbers: lineNumbersWanted(),
            lineWrap: config().editor.codeLineWrap,
            tabSpaces: config().editor.codeTabSpaces,
            t,
            onContextMenu: (event) => {
                if (editor) {
                    openEditorMenu({view: editor, t, readOnly, onSave: () => void save()}, event.clientX, event.clientY);
                }
            },
            onChange: () => {
                if (!dirty) {
                    dirty = true;
                    syncIcons();
                }
            },
        });
        const cursor = settings().restoreCursor ? rememberedCursor(ref.link) : undefined;
        if (cursor) {
            restoreCursor(editor, cursor);
        }
        syncIcons();
        editor.focus();
    })();

    return tab;
}

/** 上次关闭时来不及保存的内容还在，问用户是恢复还是丢弃。 */
function askRestore(stashedText: string, fileText: string, t: T): Promise<string> {
    return new Promise((resolve) => {
        openConfirmDialog({
            title: t("restoreTitle"),
            text: t("restoreBody"),
            cancelLabel: t("restoreDiscard"),
            onCancel: () => resolve(fileText),
            actions: [{
                label: t("restoreAccept"),
                primary: true,
                onClick: () => resolve(stashedText),
            }],
        });
    });
}

/** 行号开关在设置里改过之后，对已打开的页签立即生效。 */
export function refreshLineNumbers(settings: Settings): void {
    const preference = settings.lineNumbers;
    const show = preference === "show" ||
        (preference === "auto" && config().editor.codeSyntaxHighlightLineNum);
    allTabs().forEach((tab) => {
        tab.setLineNumbers(show);
    });
}
