/**
 * 页签内的编辑器视图。
 *
 * 外观不再照搬代码块：代码块是「嵌在正文里的一块卡片」，自带背景与操作条，
 * 而这里是一整个页签，背景应当跟随思源编辑器背景（深色浅色各用各的），
 * 所以外壳用插件自己的类名，颜色全部取自思源的 CSS 变量
 * （--b3-theme-background / --b3-theme-on-background / --b3-font-family-editor-code
 * / --b3-font-size-editor / --b3-border-color / --b3-list-hover）。
 * 语法配色两条路：默认用用户选定的那份 hljs 主题样式表（见 theme.ts），
 * 选了插件自带的方案则改用 schemes/ 里的色板，靠根元素的 data-highlight 属性切换。
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
    type THighlight,
} from "./config";
import {guessLanguage, PLAIN_TEXT} from "./language";
import {isMobileFrontend} from "./frontend";
import {debug} from "./debug";
import {loadHljs} from "./hljs";
import {closeSearch, toggleSearchPanel} from "./search";
import {openLanguageMenu} from "./language-menu";
import {openMoreMenu} from "./more-menu";
import {openFileMenu} from "./file-menu";
import {applyCodeBlockColors} from "./theme";
import {openConfirmDialog} from "./dialog";
import {confirmClose} from "./unsaved";
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
    /** 设置里改过配色方案后，对已打开的页签立即生效。 */
    setHighlight(scheme: THighlight): void;
    /** 代码块主题的样式表加载完成后，重抄一遍跟随思源的配色。 */
    refreshHighlight(): void;
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
 * 标题下拉里的一个候选文件。
 *
 * 只有调用方明确给出一组文件时才有下拉（见 open.ts 的 openFileList）；默认打开单个文件时
 * 操作条上不会多出任何东西。
 */
export interface IViewFile {
    /** 资源链接（`assets/…`），或工作区相对路径（`/data/…`）。 */
    link: string;
    /** 下拉与标题里显示的名字。 */
    title: string;
    /** 路径是工作区里的普通文件，按工作区路径读取；.sy 预览同样走这条。 */
    workspace?: boolean;
    /** 只读的 .sy 预览。 */
    sy?: boolean;
    /** 工作区文件还不存在时按空文件打开（配置文件第一次编辑就是这种情况）。 */
    allowMissing?: boolean;
}

/**
 * 视图的宿主容器。
 *
 * 桌面端默认是思源的自定义页签（`Custom` 带着 element 与 data）；移动端与桌面端的
 * 浮层形态都是对话框里的一个 div（移动端的自定义页签 API 是空实现，见 mobile.ts、
 * popup.ts）。视图本身不关心自己挂在哪，只认这几个字段。
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
     * 标题下拉里的候选文件。给了两个以上时操作条上的标题变成可点的下拉，
     * 选中另一个文件就在同一个视图里切过去。
     */
    files?: IViewFile[];
    /** 视图切换到了另一个文件，宿主据此更新页签头、对话框标题这类外壳。 */
    onSwitch?: (file: IViewFile) => void;
    /**
     * 关闭动作，同时决定要不要画那个关闭按钮。只有移动端的全屏对话框传：
     * 它铺满一屏，没有空白可点。桌面端浮层没有关闭按钮，Esc 与点空白由 popup.ts 自己接。
     */
    onClose?: () => void;
}

export function createView(host: IViewHost, t: T, settings: () => Settings): IEditorTab {
    const initialLink = String(host.data?.link ?? "");
    const files = host.files ?? [];
    /** 当前文件的描述：候选表里有它就用表里的（可能带 workspace / sy），否则按宿主给的数据。 */
    const describe = (target: string): IViewFile => files.find((item) => item.link === target) ?? {
        link: target,
        title: host.title ?? target,
        workspace: host.data?.workspace === true,
        sy: host.data?.sy === true,
    };
    let current = describe(initialLink);
    // 候选只有一个时没必要点开，等于没有下拉
    const switchable = files.length > 1;
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

    /**
     * 配色方案的开关只有一个属性。
     *
     * 跟随思源时属性不存在，插件方案才写出 `data-highlight="vscode|github"`：
     * index.scss 里所有方案规则都写成 `.editor-siyuan[data-highlight] …`，
     * 于是「跟随思源」既不写属性也不必加 :not()，方案色也不会漏到思源自己的代码块上。
     * 深浅色由思源写在 <html> 上的 data-theme-mode 决定，这里不参与。
     *
     * token 色由主题样式表自己落到 token 上，但代码块的基础底色与正文色被思源改写成了
     * `.code-block{…}`，落不到本插件的 DOM 上，所以跟随思源时还要抄一遍代码块的实际配色
     * （见 theme.ts 的 applyCodeBlockColors）。
     */
    let scheme: THighlight = settings().highlight;
    const applyHighlight = (next: THighlight): void => {
        scheme = next;
        if (next === "follow") {
            root.removeAttribute("data-highlight");
        } else {
            root.setAttribute("data-highlight", next);
        }
        applyCodeBlockColors(root, next === "follow");
    };
    applyHighlight(scheme);
    // 标题：移动端与浮层没有页签头，文件名要画在操作条上；给了候选文件时它还是下拉的触发器。
    const showTitle = host.title !== undefined || switchable;
    const titleHtml = showTitle
        ? `<span class="editor-siyuan__title${switchable ? " editor-siyuan__title--switch" : ""}"${
            switchable ? ' data-menu="true" role="button" tabindex="0"' : ""}></span>`
        : "";
    // data-menu="true" 是思源给「点开菜单的元素」打的标记，两个菜单触发元素都要带上：
    // 宿主的全局 click（boot/globalEvent/click.ts 的 globalClickHideMenu）会在任何 click
    // 之后关掉共享菜单，只有被点元素在菜单内、或带这个标记时才放过——否则点一下按钮，
    // 菜单刚弹出来就被这次点击自己关掉了。思源自己的 ⋮ 按钮也是这么标的（layout/dock/Inbox.ts）。
    root.innerHTML = `<div class="editor-siyuan__action">${host.onClose ? `
<span class="editor-siyuan__icon" data-type="close"><svg><use xlink:href="#iconClose"></use></svg></span>` : ""}${titleHtml}
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
        titleElement.textContent = current.title;
        if (switchable) {
            titleElement.setAttribute("aria-label", t("switchFile"));
        }
    }

    let ref: IAssetRef | undefined;
    let editor: EditorView | undefined;
    let dirty = false;
    // 初始模式取自设置；之后由操作条上的按钮在这个视图内切换，不回写设置
    let readOnly = current.sy === true || settings().openMode === "preview";
    // 换行按钮只在本次打开内覆盖设置，关掉页签即恢复到设置里的默认值
    let wrapOverride: boolean | undefined;
    let language = PLAIN_TEXT;
    let eol: "\n" | "\r\n" = "\n";
    let bom = false;
    let disposed = false;
    /** 加载代次：切换文件时让上一条还没跑完的加载流程作废。 */
    let loadToken = 0;

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
        const sy = current.sy === true;
        closeIcon?.setAttribute("aria-label", t("close"));
        searchIcon.setAttribute("aria-label", t("find"));
        undoIcon.setAttribute("aria-label", t("undo"));
        redoIcon.setAttribute("aria-label", t("redo"));
        saveIcon.setAttribute("aria-label", dirty ? t("saveDirty") : t("save"));
        saveIcon.classList.toggle("editor-siyuan__icon--dirty", dirty);
        readonlyIcon.setAttribute("aria-label", readOnly ? t("switchToEdit") : t("switchToPreview"));
        readonlyIcon.innerHTML = `<svg><use xlink:href="#${readOnly ? "iconEdit" : "iconEye"}"></use></svg>`;
        // .sy 预览不提供切回编辑与保存这两个入口，用思源自己的 fn__none 隐藏
        readonlyIcon.classList.toggle("fn__none", sy);
        saveIcon.classList.toggle("fn__none", sy);
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
        if (current.sy === true) {
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
        // 切换文件后链接会变：页签查找（tabFor）、暂存键与命令目标都靠它
        get link() {
            return current.link;
        },
        element: root,
        isDirty: () => dirty,
        save,
        discard: () => {
            dirty = false;
            dropStash(current.link);
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
        setHighlight: applyHighlight,
        refreshHighlight: () => applyHighlight(scheme),
        setAutocomplete: (enabled: boolean) => {
            if (editor) {
                setEditorAutocomplete(editor, enabled);
            }
        },
        dispose: () => {
            disposed = true;
            loadToken++;
            debug("dispose tab", {link: current.link, dirty, readOnly});
            if (editor) {
                if (settings().restoreCursor) {
                    rememberCursor(current.link, readCursor(editor));
                }
                if (dirty && ref && settings().stashUnsaved) {
                    putStash(current.link, {text: editor.state.doc.toString(), eol, bom, at: Date.now()});
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
            rememberLanguage(current.link, picked);
            syncIcons();
        });
    });
    // 更多菜单右对齐到按钮：思源自己的图标按钮菜单都是这么开的（isLeft 在 openMoreMenu 里给）
    moreIcon.addEventListener("click", () => {
        if (!editor || !ref) {
            return;
        }
        const rect = moreIcon.getBoundingClientRect();
        openMoreMenu({view: editor, language, link: ref.link, apiPath: ref.apiPath, readOnly, t}, rect.right, rect.bottom);
    });
    // 移动端的关闭按钮：确认与销毁都由宿主负责，视图只把点击交出去
    closeIcon?.addEventListener("click", () => host.onClose?.());

    registry.add(tab);
    host.element.append(root);
    syncIcons();

    /**
     * 把某个文件装进视图。
     *
     * 首次打开与标题下拉切换文件走同一条路，切换只是先把上一个文件换下去。
     * 每条流程带一个代次号：切走之后上一条还在等 IO 的流程直接作废，
     * 不能把旧文件的内容装进新文件的视图。
     */
    const load = async (target: IViewFile): Promise<void> => {
        const token = ++loadToken;
        current = target;
        ref = undefined;
        dirty = false;
        if (target.sy === true) {
            // .sy 预览没有可切换的编辑模式
            readOnly = true;
        }
        if (titleElement) {
            titleElement.textContent = target.title;
        }
        syncIcons();
        placeholder(t("loading"));
        if (config().readonly) {
            placeholder(t("workspaceReadonly"), true);
            return;
        }
        const workspace = target.workspace === true || target.sy === true;
        const resolved = workspace
            ? await resolveWorkspaceFile(target.link, target.allowMissing === true)
            : await resolveAsset(target.link);
        if (disposed || token !== loadToken) {
            return;
        }
        if (resolved.kind === "error") {
            debug("resolve failed", {link: target.link, workspace, message: resolved.message});
            placeholder(t("openFailed", {message: resolved.message}), true);
            return;
        }
        ref = resolved.ref;
        debug("resolved", {link: ref.link, apiPath: ref.apiPath, size: ref.size, missing: resolved.missing === true});
        if (resolved.missing !== true && ref.size > settings().maxSizeMB * 1024 * 1024) {
            debug("too large", {size: ref.size, limitMB: settings().maxSizeMB});
            placeholder(t("tooLarge", {size: megabytes(ref.size), limit: settings().maxSizeMB}), true);
            return;
        }
        let data: IAssetText;
        if (resolved.missing === true) {
            // 还没有这个文件：按空文件打开，保存时由 putFile 建出来
            data = {text: "", eol: "\n", bom: false};
        } else {
            try {
                data = await readAssetText(ref);
            } catch (error) {
                debug("read failed", ref.apiPath, error);
                placeholder(t("openFailed", {message: error instanceof Error ? error.message : String(error)}), true);
                return;
            }
        }
        if (disposed || token !== loadToken) {
            return;
        }
        eol = data.eol;
        bom = data.bom;
        language = rememberedLanguage(ref.link) ?? guessLanguage(ref.link);
        // .sy 预览只读，永远不会留下未保存的正文，也就不必问要不要恢复暂存
        const stashed = target.sy !== true && settings().stashUnsaved ? stashedEntry(ref.link) : undefined;
        const doc = stashed && stashed.text !== data.text
            ? await askRestore(ref.link, stashed.text, data.text, t)
            : data.text;
        if (disposed || token !== loadToken) {
            return;
        }
        dirty = doc !== data.text;
        // 高亮引擎没就绪就直接建编辑器的话，首次渲染会是无色的，
        // 而 StateField 只在文档变化时才重算，用户要敲一下才会看到颜色。
        await loadHljs();
        if (disposed || token !== loadToken) {
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
    };

    /**
     * 切到候选表里的另一个文件。
     *
     * 未保存的改动按关闭的规矩处理：与关闭页签共用同一条确认，取消就留在原文件上。
     */
    const switchTo = (file: IViewFile): void => {
        if (file.link === current.link) {
            return;
        }
        confirmClose(tab, t, settings, () => {
            // 上一个文件的光标位置照旧记住，切回来还在原处
            if (editor && settings().restoreCursor) {
                rememberCursor(current.link, readCursor(editor));
            }
            editor?.destroy();
            editor = undefined;
            host.onSwitch?.(file);
            void load(file);
        });
    };

    if (switchable && titleElement) {
        titleElement.addEventListener("click", () => openFileMenu(titleElement, files, current.link, switchTo));
        // 它是 role="button"，键盘也要能开
        titleElement.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                titleElement.click();
            }
        });
    }

    void load(current);

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

/** 显示类设置（行号、换行、连字、配色）在设置里改过之后，对已打开的页签立即生效。 */
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
        tab.setHighlight(settings.highlight);
        tab.setAutocomplete(settings.autocomplete);
    });
}

/**
 * 代码块主题的样式表加载完成后，让跟随思源的页签重抄一遍配色。
 *
 * 切亮暗或换代码主题时，思源换掉的是那份全局样式表，色值要等它加载完才读得到。
 */
export function refreshCodeBlockColors(): void {
    allTabs().forEach((tab) => tab.refreshHighlight());
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
