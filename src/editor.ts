/**
 * 编辑器装配。
 *
 * 内核用 CodeMirror 6——行号、搜索替换、撤销重做、缩进、软换行都由它提供，
 * 但语法高亮不用它自带的解析器：思源代码块用的是 highlight.js，
 * 两套引擎的 token 划分不同（同一段代码，函数名和属性名会被分到不同的类别）。
 * 这里由 hljs 产出高亮结果，再转成 CodeMirror 的装饰层——装饰不改文档，
 * 所以撤销重做不受影响，而 token 分类与配色与思源代码块逐字一致。
 *
 * 装饰是异步重建的（hljs 整篇重跑），长文件按体积放大防抖间隔。
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
import {highlightSelectionMatches, search, searchKeymap} from "@codemirror/search";
import {indentOnInput, indentUnit} from "@codemirror/language";
import {normalizeLanguage, PLAIN_TEXT} from "./language";

export const readOnlyCompartment = new Compartment();
export const lineNumbersCompartment = new Compartment();
export const lineWrapCompartment = new Compartment();

const initialLanguage = Facet.define<string, string>({combine: (values) => values[0] ?? PLAIN_TEXT});
const setLanguageEffect = StateEffect.define<string>();

const languageField = StateField.define<string>({
    create: (state) => state.facet(initialLanguage),
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(setLanguageEffect)) {
                return effect.value;
            }
        }
        return value;
    },
});

/**
 * hljs 的输出是 HTML，把它还原成源码区间。
 *
 * hljs 只做包裹与实体转义，不改动正文字符，所以按文本节点顺序累加长度
 * 得到的就是源码偏移；类名原样保留（`.hljs-title.function_` 这类复合类名
 * 是主题选择器的依据，不能只留前缀）。
 */
function highlightDecorations(text: string, language: string): RangeSet<Decoration> {
    const hljs = window.hljs;
    if (!hljs) {
        return Decoration.none;
    }
    const html = hljs.highlight(text, {language: normalizeLanguage(language), ignoreIllegals: true}).value;
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
    // 交给 RangeSet 自己排序：嵌套 span 会产生相同起点、不同终点的区间
    return Decoration.set(ranges, true);
}

/** 长文件的整篇重高亮会明显卡手，按体积放大防抖间隔。 */
const delayFor = (length: number): number => (length > 200_000 ? 1200 : 250);

const hljsHighlighter = ViewPlugin.fromClass(class {
    decorations: RangeSet<Decoration> = Decoration.none;
    private timer: number | undefined;

    constructor(private readonly view: EditorView) {
        this.schedule(0);
    }

    update(update: ViewUpdate): void {
        const languageChanged =
            update.startState.field(languageField) !== update.state.field(languageField);
        if (update.docChanged || languageChanged) {
            this.schedule(delayFor(update.state.doc.length));
        }
    }

    destroy(): void {
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
        }
    }

    private schedule(delay: number): void {
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.decorations = highlightDecorations(
                this.view.state.doc.toString(),
                this.view.state.field(languageField),
            );
            // 空事务用来触发一次渲染，让上面的装饰生效。它既不改文档也不改选区，
            // 因此不会进撤销栈，也不会再次触发本插件的 update。
            this.view.dispatch({});
        }, delay);
    }
}, {decorations: (instance) => instance.decorations});

export interface IEditorOptions {
    doc: string;
    language: string;
    readOnly: boolean;
    showLineNumbers: boolean;
    /** 思源 editor.codeLineWrap。 */
    lineWrap: boolean;
    /** 思源 editor.codeTabSpaces；0 表示用制表符。 */
    tabSpaces: number;
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
                search({top: true}),
                highlightSelectionMatches(),
                indentOnInput(),
                indentUnit.of(indent),
                EditorState.tabSize.of(options.tabSpaces === 0 ? 4 : options.tabSpaces),
                keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
                readOnlyCompartment.of(readOnlyExtensions(options.readOnly)),
                lineNumbersCompartment.of(options.showLineNumbers ? lineNumbers() : []),
                lineWrapCompartment.of(options.lineWrap ? EditorView.lineWrapping : []),
                initialLanguage.of(options.language),
                languageField,
                hljsHighlighter,
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
