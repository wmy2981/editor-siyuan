/**
 * 搜索替换面板。
 *
 * 搜索本身仍然是 @codemirror/search 在做：查询对象、命中高亮、⌘F / F3 快捷键、
 * 面板开关都是它的，这里只通过 search() 的 createPanel 钩子把那层壳换掉。
 * 换壳的理由：CodeMirror 自带的面板用浏览器默认控件、标签写死英文，
 * 和思源界面完全不像。
 *
 * 新壳按思源的控件规范拼：b3-form__icon + b3-text-field 做输入框，
 * block__icon + block__icon--show 做图标按钮，b3-button--small/--outline 做按钮，
 * 图标直接引用思源内置 symbol（iconSearch / iconReplace / iconExact / iconQuote /
 * iconRegex / iconLeft / iconRight / iconClose），于是线宽、悬停色、圆角、
 * ariaLabel 提示机制都与思源自己的按钮一致；文案走插件自己的 i18n。
 *
 * 三个开关借用思源现成的图标：区分大小写用 iconExact、全词匹配用 iconQuote、
 * 正则用 iconRegex。开启时按思源的惯例给 <svg> 挂 ft__primary
 * （思源自己的 searchInclude 就是这么标激活态的）。
 */
import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    replaceAll,
    replaceNext,
    search,
    SearchQuery,
    setSearchQuery,
} from "@codemirror/search";
import type {Extension} from "@codemirror/state";
import type {EditorView, Panel, ViewUpdate} from "@codemirror/view";
import {escapeHtml} from "./util";
import type {T} from "./i18n";

/** 三个开关，顺序即界面上的顺序。 */
const FLAGS = ["caseSensitive", "wholeWord", "regexp"] as const;
type TFlag = (typeof FLAGS)[number];

const FLAG_ICON: Record<TFlag, string> = {
    caseSensitive: "iconExact",
    wholeWord: "iconQuote",
    regexp: "iconRegex",
};

const FLAG_LABEL: Record<TFlag, string> = {
    caseSensitive: "searchCase",
    wholeWord: "searchWord",
    regexp: "searchRegex",
};

// main-field 是给 @codemirror/search 认的：面板已经打开时再按一次 ⌘F，
// openSearchPanel 会靠这个属性找到输入框并重新聚焦、选中。
const searchField = (t: T): string =>
    `<input class="b3-text-field b3-form__icon-input" data-type="search" main-field="true" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("searchPlaceholder"))}" aria-label="${escapeHtml(t("searchPlaceholder"))}">`;

/** 图标按钮。思源的 .block__icon 默认 opacity:0，靠 .block__icon--show 常显。 */
const iconButton = (type: string, icon: string, label: string): string =>
    `<span class="block__icon block__icon--show ariaLabel" data-position="9south" data-type="${type}" aria-label="${escapeHtml(label)}"><svg><use xlink:href="#${icon}"></use></svg></span>`;

class SiyuanSearchPanel implements Panel {
    readonly dom: HTMLElement;
    readonly top = true;

    private query: SearchQuery;
    private readonly searchField: HTMLInputElement;
    private readonly replaceField: HTMLInputElement;
    private readonly flags = new Map<TFlag, HTMLElement>();

    constructor(private readonly view: EditorView, t: T) {
        this.query = getSearchQuery(view.state);
        this.dom = document.createElement("div");
        this.dom.className = "editor-siyuan-search";
        // 两行，与思源自己的搜索面板同构：上行查找 + 开关，下行替换 + 两个按钮
        this.dom.innerHTML = `<div class="editor-siyuan-search__row">
<div class="b3-form__icon editor-siyuan-search__field">
<svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
${searchField(t)}
</div>
<div class="block__icons editor-siyuan-search__flags">
${FLAGS.map((flag) => iconButton(flag, FLAG_ICON[flag], t(FLAG_LABEL[flag]))).join("")}
${iconButton("prev", "iconLeft", t("searchPrevious"))}
${iconButton("next", "iconRight", t("searchNext"))}
${iconButton("close", "iconClose", t("searchClose"))}
</div>
</div>
<div class="editor-siyuan-search__row">
<div class="b3-form__icon editor-siyuan-search__field">
<svg class="b3-form__icon-icon"><use xlink:href="#iconReplace"></use></svg>
<input class="b3-text-field b3-form__icon-input" data-type="replace" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("replacePlaceholder"))}" aria-label="${escapeHtml(t("replacePlaceholder"))}">
</div>
<button type="button" class="b3-button b3-button--small b3-button--outline" data-type="replace">${escapeHtml(t("replace"))}</button>
<button type="button" class="b3-button b3-button--small b3-button--outline" data-type="replaceAll">${escapeHtml(t("replaceAll"))}</button>
</div>`;

        this.searchField = this.dom.querySelector<HTMLInputElement>('[data-type="search"]')!;
        this.replaceField = this.dom.querySelector<HTMLInputElement>('[data-type="replace"]')!;
        for (const flag of FLAGS) {
            this.flags.set(flag, this.dom.querySelector<HTMLElement>(`[data-type="${flag}"]`)!);
        }
        this.searchField.value = this.query.search;
        this.replaceField.value = this.query.replace;

        // 面板不在 contentDOM 里，CodeMirror 的键盘映射收不到这里的按键，
        // 所以回车、Esc 得自己接。同时一律掐断冒泡：在查找框里敲 ⌘F
        // 不该再触发思源的全局搜索。
        this.dom.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                closeSearchPanel(this.view);
                return;
            }
            if (event.key !== "Enter") {
                return;
            }
            event.preventDefault();
            if (event.target === this.replaceField) {
                replaceNext(this.view);
            } else {
                (event.shiftKey ? findPrevious : findNext)(this.view);
            }
        });

        this.searchField.addEventListener("input", () => this.commit());
        this.replaceField.addEventListener("input", () => this.commit());
        this.flags.forEach((element, flag) => {
            element.addEventListener("click", () => this.commit({[flag]: !this.query[flag]}));
        });
        this.bind("prev", () => findPrevious(this.view));
        this.bind("next", () => findNext(this.view));
        this.bind("close", () => closeSearchPanel(this.view));
        this.bind("replace", () => replaceNext(this.view));
        this.bind("replaceAll", () => replaceAll(this.view));

        this.syncFlags();
    }

    mount(): void {
        // 与 CodeMirror 原面板一致：打开时选中已有查询，直接输入即替换
        this.searchField.select();
    }

    update(update: ViewUpdate): void {
        for (const transaction of update.transactions) {
            for (const effect of transaction.effects) {
                if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
                    this.query = effect.value;
                    this.searchField.value = effect.value.search;
                    this.replaceField.value = effect.value.replace;
                    this.syncFlags();
                }
            }
        }
    }

    private bind(type: string, handler: () => void): void {
        this.dom.querySelector(`[data-type="${type}"]`)!.addEventListener("click", handler);
    }

    /** 开关是面板自己的状态，改完立刻把新查询派发出去，命中高亮随之刷新。 */
    private commit(override?: Partial<Record<TFlag, boolean>>): void {
        const next = new SearchQuery({
            search: this.searchField.value,
            replace: this.replaceField.value,
            caseSensitive: override?.caseSensitive ?? this.query.caseSensitive,
            wholeWord: override?.wholeWord ?? this.query.wholeWord,
            regexp: override?.regexp ?? this.query.regexp,
        });
        if (next.eq(this.query)) {
            return;
        }
        this.query = next;
        this.syncFlags();
        this.view.dispatch({effects: setSearchQuery.of(next)});
    }

    private syncFlags(): void {
        this.flags.forEach((element, flag) => {
            element.querySelector("svg")!.classList.toggle("ft__primary", this.query[flag]);
        });
    }
}

/** 换掉 CodeMirror 自带的面板；查询状态、命中高亮、快捷键都保持原样。 */
export const siyuanSearch = (t: T): Extension =>
    search({top: true, createPanel: (view) => new SiyuanSearchPanel(view, t)});
