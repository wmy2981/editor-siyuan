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
 * 顶部一条操作条：左侧是可点的语言标签、撤销 / 重做与换行开关，右侧依次是查找、只读切换与保存。
 * 图标按钮只留 aria-label 给读屏，不挂思源的 .ariaLabel：那一栏紧贴正文，
 * 悬浮提示弹出时会压住第一行代码，得不偿失。
 */
import {showMessage, type Plugin} from "siyuan";
import type {EditorView} from "@codemirror/view";
import {readAssetText, resolveAsset, resolveWorkspaceFile, writeAssetText, type IAssetRef, type IAssetText} from "./asset";
import {
    applyRedo,
    applyUndo,
    canRedo,
    canUndo,
    createEditor,
    readCursor,
    restoreCursor,
    setEditorAutocomplete,
    setEditorLanguage,
    setEditorLigatures,
    setEditorLineNumbers,
    setEditorLineWrap,
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
import {isMobileFrontend} from "./frontend";
import {debug} from "./debug";
import {loadHljs} from "./hljs";
import {closeSearch, toggleSearchPanel} from "./search";
import {openLanguageMenu} from "./language-menu";
import {openMoreMenu} from "./more-menu";
import {openConfirmDialog} from "./dialog";
import {openEditorMenu} from "./context-menu";
import {ICON_SAVE, ICON_WRAP} from "./icons";
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
    /** 设置里改过换行偏好后，对已打开的页签立即生效。 */
    setLineWrap(wrap: boolean): void;
    /** 设置里改过连字偏好后，对已打开的页签立即生效。 */
    setLigatures(ligatures: boolean): void;
    /** 设置里改过字号偏好后，对已打开的页签立即生效。 */
    setFontSize(size: number): void;
    /** 设置里改过补全开关后，对已打开的页签立即生效；只读页签始终关闭。 */
    setAutocomplete(enabled: boolean): void;
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

/**
 * 视图的宿主容器。
 *
 * 桌面端默认是思源的自定义页签（`Custom` 带着 element 与 data）；移动端与桌面端的
 * 浮层形态都是对话框里的一个 div（移动端的自定义页签 API 是空实现，见 mobile.ts、
 * popup.ts）。视图本身不关心自己挂在哪，只认这三个字段。
 */
export interface IViewHost {
    /** 视图挂到这里。页签给的 Custom.element 只是 Element，对话框给的 div 是 HTMLElement。 */
    element: Element;
    /** 页签或对话框带过来的数据：`{link}`，`.sy` 预览另有 `{sy: true}`。 */
    data?: Record<string, unknown>;
    /**
     * 标题。移动端全屏对话框与桌面端浮层都没有页签头，操作条上要显示文件名；
     * 页签里由页签头负责，不传。
     */
    title?: string;
    /**
     * 关闭动作，同时决定要不要画那个关闭按钮。只有移动端的全屏对话框传：
     * 它铺满一屏，没有空白可点。桌面端浮层没有关闭按钮，Esc 与点空白由 popup.ts 自己接。
     */
    onClose?: () => void;
}

export function createView(host: IViewHost, t: T, settings: () => Settings): IEditorTab {
    const link = String(host.data?.link ?? "");
    // .sy 文档预览：只读到底，不提供编辑、保存与暂存
    const syDoc = host.data?.sy === true;
    // 触屏（手机 App 与手机浏览器）：长按交给系统菜单，也不要自动聚焦把软键盘顶起来
    const touch = isMobileFrontend();

    const root = document.createElement("div");
    root.className = "editor-siyuan";
    /**
     * 字号写在根元素的自定义属性上，由样式表里 .cm-scroller 的 font-size 取用。
     * 0 表示跟随思源：去掉属性后回落到与代码块同字号的那条 calc。
     */
    const applyFontSize = (size: number): void => {
        if (size > 0) {
            root.style.setProperty("--editor-siyuan-font-size", `${size}px`);
        } else {
            root.style.removeProperty("--editor-siyuan-font-size");
        }
    };
    applyFontSize(settings().fontSize);
    // data-menu="true" 是思源给「点开菜单的元素」打的标记，两个菜单触发元素都要带上：
    // 宿主的全局 click（boot/globalEvent/click.ts 的 globalClickHideMenu）会在任何 click
    // 之后关掉共享菜单，只有被点元素在菜单内、或带这个标记时才放过——否则点一下按钮，
    // 菜单刚弹出来就被这次点击自己关掉了。思源自己的 ⋮ 按钮也是这么标的（layout/dock/Inbox.ts）。
    root.innerHTML = `<div class="editor-siyuan__action">${host.onClose ? `
<span class="editor-siyuan__icon" data-type="close"><svg><use xlink:href="#iconClose"></use></svg></span>` : ""}${host.title !== undefined ? `
<span class="editor-siyuan__title"></span>` : ""}
<span class="editor-siyuan__language" data-menu="true"></span>
<span class="editor-siyuan__icon" data-type="undo"><svg><use xlink:href="#iconUndo"></use></svg></span>
<span class="editor-siyuan__icon" data-type="redo"><svg><use xlink:href="#iconRedo"></use></svg></span>
<span class="editor-siyuan__icon" data-type="wrap"><svg><use xlink:href="#${ICON_WRAP}"></use></svg></span>
<span class="fn__flex-1"></span>
<span class="editor-siyuan__icon" data-type="search"><svg><use xlink:href="#iconSearch"></use></svg></span>
<span class="editor-siyuan__icon" data-type="readonly"><svg><use xlink:href="#iconEye"></use></svg></span>
<span class="editor-siyuan__icon" data-type="save"><svg><use xlink:href="#${ICON_SAVE}"></use></svg></span>
<span class="editor-siyuan__icon" data-type="more" data-menu="true"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>
<div class="editor-siyuan__body">
<div class="editor-siyuan__mount"></div>
</div>`;

    const mount = root.querySelector<HTMLElement>(".editor-siyuan__mount")!;
    const languageLabel = root.querySelector<HTMLElement>(".editor-siyuan__language")!;
    const undoIcon = root.querySelector<HTMLElement>('[data-type="undo"]')!;
    const redoIcon = root.querySelector<HTMLElement>('[data-type="redo"]')!;
    const wrapIcon = root.querySelector<HTMLElement>('[data-type="wrap"]')!;
    const searchIcon = root.querySelector<HTMLElement>('[data-type="search"]')!;
    const saveIcon = root.querySelector<HTMLElement>('[data-type="save"]')!;
    const readonlyIcon = root.querySelector<HTMLElement>('[data-type="readonly"]')!;
    const moreIcon = root.querySelector<HTMLElement>('[data-type="more"]')!;
    const closeIcon = root.querySelector<HTMLElement>('[data-type="close"]');
    const titleElement = root.querySelector<HTMLElement>(".editor-siyuan__title");
    if (titleElement) {
        titleElement.textContent = host.title ?? "";
    }

    // .sy 预览不提供切回编辑与保存这两个入口，用思源自己的 fn__none 隐藏
    if (syDoc) {
        readonlyIcon.classList.add("fn__none");
        saveIcon.classList.add("fn__none");
    }

    let ref: IAssetRef | undefined;
    let editor: EditorView | undefined;
    let dirty = false;
    // 初始模式取自设置；之后由操作条上的按钮在这个页签内切换，不回写设置
    let readOnly = syDoc || settings().openMode === "preview";
    // 换行按钮只在本次打开内覆盖设置，关掉页签即恢复到设置里的默认值
    let wrapOverride: boolean | undefined;
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

    /** 是否自动换行：auto 跟随思源的 editor.codeLineWrap。 */
    const lineWrapWanted = (): boolean => {
        const preference = settings().lineWrap;
        return preference === "on" ||
            (preference === "auto" && config().editor.codeLineWrap);
    };

    /** 实际生效的换行状态：操作条上手动切过就按手动那次，否则按设置。 */
    const wrapOn = (): boolean => wrapOverride ?? lineWrapWanted();

    /** 连字是否生效：auto 跟随思源的 editor.codeLigatures。 */
    const ligaturesWanted = (): boolean => {
        const preference = settings().ligatures;
        return preference === "on" ||
            (preference === "auto" && config().editor.codeLigatures);
    };

    /**
     * 撤销 / 重做按钮的状态。
     *
     * 预览（只读）模式下整对隐藏——那时正文改不动，撤销栈也没有意义；
     * 编辑模式下按 CodeMirror 的撤销栈深度置灰，与 ⌘Z / ⇧⌘Z 的可用性同源。
     * 每次改动都要重算，所以这里只碰这两个按钮，不重写整排图标。
     */
    const syncHistory = (): void => {
        const buttons: Array<[HTMLElement, boolean]> = [
            [undoIcon, editor !== undefined && canUndo(editor)],
            [redoIcon, editor !== undefined && canRedo(editor)],
        ];
        for (const [icon, available] of buttons) {
            icon.classList.toggle("fn__none", readOnly);
            icon.classList.toggle("editor-siyuan__icon--disabled", !available);
            icon.setAttribute("aria-disabled", String(!available));
        }
    };

    /**
     * 换行按钮的开关状态：开着挂主色，关着是普通灰。
     *
     * 这是个状态按钮而不是一次性的动作按钮，所以用 aria-pressed 把状态也交给读屏。
     */
    const syncWrap = (): void => {
        const on = wrapOn();
        wrapIcon.classList.toggle("editor-siyuan__icon--active", on);
        wrapIcon.setAttribute("aria-pressed", String(on));
    };

    const syncIcons = (): void => {
        closeIcon?.setAttribute("aria-label", t("close"));
        searchIcon.setAttribute("aria-label", t("find"));
        undoIcon.setAttribute("aria-label", t("undo"));
        redoIcon.setAttribute("aria-label", t("redo"));
        saveIcon.setAttribute("aria-label", dirty ? t("saveDirty") : t("save"));
        saveIcon.classList.toggle("editor-siyuan__icon--dirty", dirty);
        readonlyIcon.setAttribute("aria-label", readOnly ? t("switchToEdit") : t("switchToPreview"));
        readonlyIcon.innerHTML = `<svg><use xlink:href="#${readOnly ? "iconEdit" : "iconEye"}"></use></svg>`;
        moreIcon.setAttribute("aria-label", t("more"));
        wrapIcon.setAttribute("aria-label", t("lineWrap"));
        // 空标签会被思源自己的 CSS 补上 "language"，加载完成前保持空
        languageLabel.textContent = editor ? language : "";
        languageLabel.setAttribute("aria-label", t("languageLabel"));
        syncHistory();
        syncWrap();
    };

    const save = async (): Promise<boolean> => {
        if (!ref || !editor) {
            return false;
        }
        if (syDoc) {
            // 预览的 .sy 文档没有可切换的编辑模式，不能复用「切回编辑后才能保存」那句提示
            showMessage(t("syReadonly"), 3000);
            return false;
        }
        if (readOnly) {
            showMessage(t("readonlyEditor"));
            return false;
        }
        const error = await writeAssetText(ref, {text: editor.state.doc.toString(), eol, bom});
        if (error) {
            debug("save failed", ref.apiPath, error);
            showMessage(`${t("saveFailed")}: ${error}`, 6000, "error");
            return false;
        }
        dirty = false;
        dropStash(ref.link);
        syncIcons();
        debug("saved", ref.apiPath);
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
        setLineWrap: (wrap: boolean) => {
            // 在操作条上手动切过之后，这个页签就按自己的选择走，不再跟随设置
            if (editor && wrapOverride === undefined) {
                setEditorLineWrap(editor, wrap);
            }
        },
        setLigatures: (ligatures: boolean) => {
            if (editor) {
                setEditorLigatures(editor, ligatures);
            }
        },
        setFontSize: applyFontSize,
        setAutocomplete: (enabled: boolean) => {
            if (editor) {
                setEditorAutocomplete(editor, enabled);
            }
        },
        dispose: () => {
            disposed = true;
            debug("dispose tab", {link, dirty, readOnly});
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
            toggleSearchPanel(editor);
        }
    });
    undoIcon.addEventListener("click", () => {
        if (editor && !readOnly && canUndo(editor)) {
            applyUndo(editor);
        }
    });
    redoIcon.addEventListener("click", () => {
        if (editor && !readOnly && canRedo(editor)) {
            applyRedo(editor);
        }
    });
    // 换行只在本次打开内生效：不回写设置，下次打开仍按设置里的默认值
    wrapIcon.addEventListener("click", () => {
        if (!editor) {
            return;
        }
        wrapOverride = !wrapOn();
        setEditorLineWrap(editor, wrapOverride);
        syncWrap();
    });
    // 右键＝只收起：面板占着正文上方一行，收起来要能一步到位
    searchIcon.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (editor) {
            closeSearch(editor);
        }
    });
    readonlyIcon.addEventListener("click", () => {
        readOnly = !readOnly;
        if (editor) {
            setEditorReadOnly(editor, readOnly);
            // 预览模式不弹候选列表，切回编辑再按设置恢复
            setEditorAutocomplete(editor, settings().autocomplete);
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
    // 更多菜单右对齐到按钮：思源自己的图标按钮菜单都是这么开的（isLeft 在 openMoreMenu 里给）
    moreIcon.addEventListener("click", () => {
        if (!editor) {
            return;
        }
        const rect = moreIcon.getBoundingClientRect();
        openMoreMenu({view: editor, language, link, readOnly, t}, rect.right, rect.bottom);
    });
    // 移动端的关闭按钮：确认与销毁都由宿主负责，视图只把点击交出去
    closeIcon?.addEventListener("click", () => host.onClose?.());

    registry.add(tab);
    host.element.append(root);
    syncIcons();
    placeholder(t("loading"));

    void (async () => {
        if (config().readonly) {
            placeholder(t("workspaceReadonly"), true);
            return;
        }
        const resolved = syDoc ? await resolveWorkspaceFile(link) : await resolveAsset(link);
        if (disposed) {
            return;
        }
        if (resolved.kind === "error") {
            debug("resolve failed", {link, syDoc, message: resolved.message});
            placeholder(t("openFailed", {message: resolved.message}), true);
            return;
        }
        ref = resolved.ref;
        debug("resolved", {link: ref.link, apiPath: ref.apiPath, size: ref.size});
        if (ref.size > settings().maxSizeMB * 1024 * 1024) {
            debug("too large", {size: ref.size, limitMB: settings().maxSizeMB});
            placeholder(t("tooLarge", {size: megabytes(ref.size), limit: settings().maxSizeMB}), true);
            return;
        }
        let data: IAssetText;
        try {
            data = await readAssetText(ref);
        } catch (error) {
            debug("read failed", ref.apiPath, error);
            placeholder(t("openFailed", {message: error instanceof Error ? error.message : String(error)}), true);
            return;
        }
        if (disposed) {
            return;
        }
        eol = data.eol;
        bom = data.bom;
        language = rememberedLanguage(ref.link) ?? guessLanguage(ref.link);
        // .sy 预览只读，永远不会留下未保存的正文，也就不必问要不要恢复暂存
        const stashed = !syDoc && settings().stashUnsaved ? stashedEntry(ref.link) : undefined;
        const doc = stashed && stashed.text !== data.text
            ? await askRestore(ref.link, stashed.text, data.text, t)
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
            lineWrap: lineWrapWanted(),
            ligatures: ligaturesWanted(),
            tabSpaces: config().editor.codeTabSpaces,
            autocomplete: settings().autocomplete,
            // 触屏交给浏览器的原生光标与选区：CodeMirror 不处理触屏选区，
            // 自绘会把原生光标和选区一起藏掉（见 IEditorOptions.drawSelection）
            drawSelection: !touch,
            t,
            // 移动端不拦 contextmenu：长按该交给系统那套文本菜单（剪切 / 复制 / 粘贴 / 全选），
            // 自制菜单在触屏上既和它重复，还会抢掉系统的选择手势。桌面端照旧用自己的右键菜单。
            onContextMenu: touch ? undefined : (event) => {
                if (editor) {
                    openEditorMenu({view: editor, t, readOnly, onSave: () => void save()}, event.clientX, event.clientY);
                }
            },
            onChange: () => {
                if (!dirty) {
                    dirty = true;
                    syncIcons();
                    return;
                }
                // 撤销栈深度每次改动都可能变，但那几项图标不必因此重写
                syncHistory();
            },
        });
        const cursor = settings().restoreCursor ? rememberedCursor(ref.link) : undefined;
        if (cursor) {
            restoreCursor(editor, cursor);
        }
        syncIcons();
        // 移动端不自动聚焦：焦点一落到正文上就会弹起软键盘，盖掉半屏内容，
        // 而用户这一下点击本身只是想看一眼文件。桌面端（页签与浮层都一样）仍然聚焦，省一次点击。
        if (!touch) {
            editor.focus();
        }
        debug("editor ready", {
            link: ref.link,
            language,
            readOnly,
            stashRestored: dirty,
            cursor: cursor?.anchor,
            length: data.text.length,
        });
    })();

    return tab;
}

/**
 * 上次关闭时来不及保存的内容还在，问用户怎么处理。
 *
 * 三个按钮语义不同，所以不允许 Esc、点击空白这类「跳过」：忽略与丢弃都会载入磁盘内容，
 * 区别只在暂存留不留；恢复只是把暂存载回编辑器，是否保存仍由用户决定。
 */
function askRestore(link: string, stashedText: string, fileText: string, t: T): Promise<string> {
    return new Promise((resolve) => {
        openConfirmDialog({
            title: t("restoreTitle"),
            text: t("restoreBody"),
            dismissable: false,
            // 兜底：万一被别的路径关掉（比如批量隐藏面板），按「忽略」处理，
            // 既不会把暂存丢掉，也不会把用户的选择替作已经做过
            onCancel: () => resolve(fileText),
            actions: [
                {
                    label: t("restoreIgnore"),
                    onClick: () => resolve(fileText),
                },
                {
                    label: t("restoreDiscard"),
                    danger: true,
                    onClick: () => {
                        dropStash(link);
                        resolve(fileText);
                    },
                },
                {
                    label: t("restoreAccept"),
                    primary: true,
                    onClick: () => resolve(stashedText),
                },
            ],
        });
    });
}

/** 参与「跟随思源设置」的那几项思源编辑器配置。 */
interface IEditorConf {
    codeLineWrap: boolean;
    codeLigatures: boolean;
    codeSyntaxHighlightLineNum: boolean;
}

/** 显示类设置（行号、换行、连字）在设置里改过之后，对已打开的页签立即生效。 */
export function refreshEditorSettings(settings: Settings, editor: IEditorConf = config().editor): void {
    const showLineNumbers = settings.lineNumbers === "show" ||
        (settings.lineNumbers === "auto" && editor.codeSyntaxHighlightLineNum);
    const wrap = settings.lineWrap === "on" ||
        (settings.lineWrap === "auto" && editor.codeLineWrap);
    const ligatures = settings.ligatures === "on" ||
        (settings.ligatures === "auto" && editor.codeLigatures);
    allTabs().forEach((tab) => {
        tab.setLineNumbers(showLineNumbers);
        tab.setLineWrap(wrap);
        tab.setLigatures(ligatures);
        tab.setFontSize(settings.fontSize);
        tab.setAutocomplete(settings.autocomplete);
    });
}

/**
 * 思源自己的编辑器设置改了之后，把「跟随思源设置」的那几项重新算一遍。
 *
 * 思源先把这个事件派发给插件、之后才把新配置写进 `window.siyuan.config`，
 * 所以只能读事件里那份 editor（theme.ts 处理 setAppearance 是同一个处境）。
 */
export function watchEditorConfig(plugin: Plugin, settings: () => Settings): void {
    plugin.eventBus.on("ws-main", (event: CustomEvent<{cmd?: string; data?: {editor?: IEditorConf}}>) => {
        const editor = event.detail?.data?.editor;
        if (event.detail?.cmd !== "setConf" || !editor) {
            return;
        }
        refreshEditorSettings(settings(), editor);
    });
}
