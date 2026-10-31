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
 * 搜索面板换成思源样式（见 search.ts），⌘F 与顶栏的查找按钮都是开/关同一个面板；
 * 右键菜单交给 context-menu.ts。
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
import {defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth} from "@codemirror/commands";
import {searchKeymap} from "@codemirror/search";
import {indentOnInput, indentUnit} from "@codemirror/language";
import {normalizeLanguage, PLAIN_TEXT} from "./language";
import {siyuanSearch, toggleSearchPanel} from "./search";
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
    /** 代码字体的连字是否生效；思源 editor.codeLigatures。 */
    ligatures: boolean;
    /** 思源 editor.codeTabSpaces；0 表示用制表符。 */
    tabSpaces: number;
    /** 搜索面板的文案。 */
    t: T;
    /** 正文里按下右键；搜索面板里的输入框不走这里，留给宿主自己的原生菜单。 */
    onContextMenu?: (event: MouseEvent) => void;
    onChange: () => void;
}

/**
 * 只读语义只由 EditorState.readOnly 表达，EditorView.editable 永远保持开启。
 *
 * 关掉 editable 会让 .cm-content 失去 contenteditable，连焦点也一起没有：CodeMirror 的
 * keymap 挂在 contentDOM 上，元素不聚焦就收不到按键，Mod-a 的 selectAll 永远不执行，
 * Ctrl+A 落到浏览器默认的页面级全选，选区越过编辑器边界圈进宿主页面的文字；移动端
 * 也因此没有插入符与选区手柄（issue #23 / #24）。readOnly 本身已经拦住输入、粘贴与拖放。
 */
function readOnlyExtensions(readOnly: boolean): Extension {
    return [
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(true),
        // 只读时正文要能落光标、拖动要能出选区手柄，但不该顶起软键盘：
        // virtualkeyboardpolicy 只有 Android Chromium 认，inputmode=none 兜住 iOS。
        // 桌面端没有软键盘，这两条属性在那里不起作用。
        readOnly
            ? EditorView.contentAttributes.of({virtualkeyboardpolicy: "manual", inputmode: "none"})
            : [],
    ];
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
                keymap.of([
                    // ⌘F 是开关而不只是打开，所以压在 searchKeymap 之前：
                    // 同一批绑定里靠前的那条先命中，返回 true 后面的就不再跑。
                    {key: "Mod-f", run: toggleSearchPanel, scope: "editor search-panel"},
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                    indentWithTab,
                ]),
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
    setEditorLigatures(view, options.ligatures);
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

/**
 * 连字开关。
 *
 * 与思源代码块的做法一致（protyle/render/highlightRender.ts 给的也是内联样式）：
 * 关闭时写 none，开启时写 normal。写在 .cm-editor 上由整棵编辑器继承，
 * 不必为此新增一条要靠选择器权重去压 CodeMirror 的样式规则。
 */
export const setEditorLigatures = (view: EditorView, ligatures: boolean): void => {
    view.dom.style.fontVariantLigatures = ligatures ? "normal" : "none";
};

export const setEditorLanguage = (view: EditorView, language: string): void => {
    view.dispatch({effects: setLanguageEffect.of(language)});
};

/**
 * 撤销与重做。
 *
 * 操作条上的两个按钮与快捷键走同一个实现：撤销栈归 CodeMirror 的 history()，
 * 深度也由它给，所以按钮的可用状态与 ⌘Z / ⇧⌘Z 永远一致，不会各算一套。
 */
export const canUndo = (view: EditorView): boolean => undoDepth(view.state) > 0;

export const canRedo = (view: EditorView): boolean => redoDepth(view.state) > 0;

export const applyUndo = (view: EditorView): void => {
    undo(view);
};

export const applyRedo = (view: EditorView): void => {
    redo(view);
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
