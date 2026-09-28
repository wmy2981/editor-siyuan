/**
 * 编辑器装配。
 *
 * 内核用 CodeMirror 6——行号、搜索替换、撤销重做、缩进、软换行都由它提供，
 * 但语法高亮不用它自带的解析器：思源代码块用的是 highlight.js，
 * 两套引擎的 token 划分不同（同一段代码，函数名和属性名会被分到不同的类别）。
 * 这里由 hljs 产出高亮结果，再转成 CodeMirror 的装饰——装饰不改文档，
 * 所以撤销重做不受影响，而 token 分类与配色与思源代码块逐字一致。
 *
 * 高亮放在 StateField 里、随文档改动同步重算，而不是事后异步补算：
 * 异步补算会在停止输入后一次性换掉整篇装饰，用户看到的是颜色"迟一步窜动"。
 * 代价是每敲一键都要整篇重跑 hljs，所以按实测耗时自适应：一次整篇超过
 * SYNC_BUDGET_MS 就退回「先映射旧装饰、停止输入后再补算」。
 *
 * 高亮结果直接取 hljs 返回的 token 树，而不是「序列化成 HTML、再解析回 DOM、再遍历取区间」：
 * 那一圈多出来的 DOM 解析与遍历占整篇耗时的三到四成。实测参考（本机，思源自带的那份 hljs，
 * 同一批样本各取中位数）：markdown 42k 字符 10.7 → 6.1 ms、149k 34.6 → 23.8 ms；
 * javascript 50k 字符 9.9 → 5.9 ms、338k 90.0 → 61.5 ms。同步档里装得下的文件因此大了约五成。
 * 两条路径产出的区间与类名逐条相同（含 markdown 围栏、xml 内嵌 script 这类子语言）；
 * hljs 内部仍会把结果拼成一份 HTML 字符串（我们不换它的 emitter），这部分省不掉。
 *
 * 刻意不加 highlightSelectionMatches()：它会把光标所在词的所有其它出现位置
 * 高亮成写死的 #99ff7780（黄绿），既不跟随思源主题，又会在每次按键时随
 * 光标下的词批量亮灭，整屏多行跟着重绘。
 *
 * 搜索面板换成思源样式（见 search.ts），右键菜单交给 context-menu.ts。
 */
import {
    Compartment,
    EditorState,
    Facet,
    type Range,
    type RangeSet,
    StateEffect,
    StateField,
    type Extension,
} from "@codemirror/state";
import {
    Decoration,
    drawSelection,
    EditorView,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    type ViewUpdate,
    ViewPlugin,
} from "@codemirror/view";
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {searchKeymap} from "@codemirror/search";
import {indentOnInput, indentUnit} from "@codemirror/language";
import {normalizeLanguage, PLAIN_TEXT} from "./language";
import {siyuanSearch} from "./search";
import type {T} from "./i18n";

export const readOnlyCompartment = new Compartment();
export const lineNumbersCompartment = new Compartment();
export const lineWrapCompartment = new Compartment();

/** 一次整篇高亮超过这个耗时就不再逐键同步做。 */
const SYNC_BUDGET_MS = 8;

/** 大文件里退回防抖后，停止输入多久再补算。 */
const delayFor = (length: number): number => (length > 200_000 ? 1200 : 250);

const initialLanguage = Facet.define<string, string>({combine: (values) => values[0] ?? PLAIN_TEXT});
const setLanguageEffect = StateEffect.define<string>();
/** 防抖到期后要求补算一次整篇高亮。 */
const recomputeEffect = StateEffect.define<null>();

interface IHighlight {
    decorations: RangeSet<Decoration>;
    language: string;
    /** 上一次整篇高亮的实测耗时，用来决定下一次还能不能同步做。 */
    cost: number;
}

/**
 * scope 名转 CSS 类名，与 hljs 内部把 token 树渲染成 HTML 时的做法一致：
 * `language:x` 转成 `language-x`；带点的多级 scope 展开成 `hljs-title function_`
 * 这样的复合类名（主题选择器就写在这个复合类名上），后缀下划线的个数表示层级。
 * 前缀写死 hljs-：我们复用思源那份主题样式表，其中的选择器就是这个前缀。
 */
function scopeToClass(scope: string): string {
    if (scope.startsWith("language:")) {
        return scope.replace("language:", "language-");
    }
    const pieces = scope.split(".");
    const head = `hljs-${pieces.shift()}`;
    const tail = pieces.map((piece, index) => `${piece}${"_".repeat(index + 1)}`);
    return [head, ...tail].join(" ");
}

/**
 * 走 hljs 的 token 树取源码区间。
 *
 * 树里只有文本与 scope 两种节点，按文本长度累加就是源码偏移；取不到树时返回
 * undefined，由 buildDecorations 退回解析 HTML。
 */
function treeRanges(emitter: IHljsEmitter | undefined): Range<Decoration>[] | undefined {
    const children = emitter?.rootNode?.children;
    if (!children) {
        return undefined;
    }
    const ranges: Range<Decoration>[] = [];
    let offset = 0;
    const walk = (node: IHljsNode | string): void => {
        if (typeof node === "string") {
            offset += node.length;
            return;
        }
        const from = offset;
        node.children?.forEach(walk);
        if (node.scope && offset > from) {
            ranges.push(Decoration.mark({class: scopeToClass(node.scope)}).range(from, offset));
        }
    };
    children.forEach(walk);
    return ranges;
}

/**
 * 退回路径：hljs 的输出是 HTML，把它还原成源码区间。
 *
 * hljs 只做包裹与实体转义，不改动正文字符，所以按文本节点顺序累加长度
 * 得到的就是源码偏移；类名原样保留（`.hljs-title.function_` 这类复合类名
 * 是主题选择器的依据，不能只留前缀）。
 */
function htmlRanges(html: string): Range<Decoration>[] {
    const container = document.createElement("div");
    container.innerHTML = html;
    const ranges: Range<Decoration>[] = [];
    let offset = 0;
    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            offset += node.textContent?.length ?? 0;
            return;
        }
        if (!(node instanceof HTMLElement)) {
            return;
        }
        const from = offset;
        node.childNodes.forEach(walk);
        const classes = Array.from(node.classList);
        if (classes.length > 0 && offset > from) {
            ranges.push(Decoration.mark({class: classes.join(" ")}).range(from, offset));
        }
    };
    container.childNodes.forEach(walk);
    return ranges;
}

function buildDecorations(text: string, language: string): RangeSet<Decoration> {
    const hljs = window.hljs;
    if (!hljs) {
        return Decoration.none;
    }
    const result = hljs.highlight(text, {language: normalizeLanguage(language), ignoreIllegals: true});
    // 交给 RangeSet 自己排序：嵌套 scope 会产生相同起点、不同终点的区间
    return Decoration.set(treeRanges(result._emitter) ?? htmlRanges(result.value), true);
}

function computeHighlight(text: string, language: string): IHighlight {
    const started = performance.now();
    const decorations = buildDecorations(text, language);
    return {decorations, language, cost: performance.now() - started};
}

const highlightField = StateField.define<IHighlight>({
    create: (state) => computeHighlight(state.doc.toString(), state.facet(initialLanguage)),
    update: (value, transaction) => {
        let language = value.language;
        let forced = false;
        for (const effect of transaction.effects) {
            if (effect.is(setLanguageEffect)) {
                language = effect.value;
            } else if (effect.is(recomputeEffect)) {
                forced = true;
            }
        }
        if (!transaction.docChanged && !forced && language === value.language) {
            return value;
        }
        // 换语言是明确的单次操作，文档没变时也直接同步重算
        if (forced || !transaction.docChanged || value.cost <= SYNC_BUDGET_MS) {
            return computeHighlight(transaction.state.doc.toString(), language);
        }
        // 整篇重算太慢：先把旧装饰按改动映射过去（颜色仍然跟着原字符走），
        // 停止输入后再由下面的插件补算一次。
        return {decorations: value.decorations.map(transaction.changes), language, cost: value.cost};
    },
});

/** 只在「同步档放不下」时工作：停止输入后补算一次整篇高亮。 */
const hljsDebounce = ViewPlugin.fromClass(class {
    private timer: number | undefined;

    constructor(private readonly view: EditorView) {
    }

    update(update: ViewUpdate): void {
        if (!update.docChanged) {
            return;
        }
        if (update.state.field(highlightField).cost <= SYNC_BUDGET_MS) {
            this.cancel();
            return;
        }
        this.schedule(delayFor(update.state.doc.length));
    }

    destroy(): void {
        this.cancel();
    }

    private cancel(): void {
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private schedule(delay: number): void {
        this.cancel();
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.view.dispatch({effects: recomputeEffect.of(null)});
        }, delay);
    }
});

export interface IEditorOptions {
    doc: string;
    language: string;
    readOnly: boolean;
    showLineNumbers: boolean;
    /** 思源 editor.codeLineWrap。 */
    lineWrap: boolean;
    /** 思源 editor.codeTabSpaces；0 表示用制表符。 */
    tabSpaces: number;
    /** 搜索面板的文案。 */
    t: T;
    /** 正文里按下右键；搜索面板里的输入框不走这里，留给宿主自己的原生菜单。 */
    onContextMenu?: (event: MouseEvent) => void;
    onChange: () => void;
}

function readOnlyExtensions(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export function createEditor(parent: HTMLElement, options: IEditorOptions): EditorView {
    const indent = options.tabSpaces === 0 ? "\t" : " ".repeat(options.tabSpaces);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: options.doc,
            extensions: [
                history(),
                highlightSpecialChars(),
                drawSelection(),
                siyuanSearch(options.t),
                indentOnInput(),
                indentUnit.of(indent),
                EditorState.tabSize.of(options.tabSpaces === 0 ? 4 : options.tabSpaces),
                keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
                readOnlyCompartment.of(readOnlyExtensions(options.readOnly)),
                lineNumbersCompartment.of(options.showLineNumbers ? lineNumbers() : []),
                lineWrapCompartment.of(options.lineWrap ? EditorView.lineWrapping : []),
                initialLanguage.of(options.language),
                highlightField,
                EditorView.decorations.from(highlightField, (value) => value.decorations),
                hljsDebounce,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        options.onChange();
                    }
                }),
            ],
        }),
    });
    // CodeMirror 已经处理过的按键不再冒泡：⌘F、⌘R 等既是它的搜索快捷键，
    // 也是思源的全局快捷键，不拦住会同时弹出思源的文档搜索。
    // 必须挂在冒泡阶段，才能确定 CodeMirror 已经先看过这个事件。
    view.dom.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) {
            event.stopPropagation();
        }
    });
    // 右键菜单：正文交回插件自建（思源自己的编辑器菜单只认 ProseMirror 选区），
    // 搜索面板里的输入框则原样放行，让宿主弹它的 Electron 原生菜单。
    view.dom.addEventListener("contextmenu", (event) => {
        if (!options.onContextMenu || (event.target as HTMLElement).closest(".editor-siyuan-search")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        options.onContextMenu(event);
    });
    return view;
}

export const setEditorReadOnly = (view: EditorView, readOnly: boolean): void => {
    view.dispatch({effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly))});
};

export const setEditorLineNumbers = (view: EditorView, show: boolean): void => {
    view.dispatch({effects: lineNumbersCompartment.reconfigure(show ? lineNumbers() : [])});
};

export const setEditorLineWrap = (view: EditorView, wrap: boolean): void => {
    view.dispatch({effects: lineWrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])});
};

export const setEditorLanguage = (view: EditorView, language: string): void => {
    view.dispatch({effects: setLanguageEffect.of(language)});
};

/** 保存/恢复滚动位置与光标。 */
export interface IEditorCursor {
    anchor: number;
    scrollTop: number;
}

export function readCursor(view: EditorView): IEditorCursor {
    return {anchor: view.state.selection.main.anchor, scrollTop: view.scrollDOM.scrollTop};
}

export function restoreCursor(view: EditorView, cursor: IEditorCursor): void {
    const anchor = Math.min(cursor.anchor, view.state.doc.length);
    view.dispatch({selection: {anchor}});
    view.scrollDOM.scrollTop = cursor.scrollTop;
}
