// 思源在渲染代码块时用 addScript 注入 highlight.js，脚本顶部是 `var hljs = ...`，
// 因此它在页面上是一个真实可用的全局对象，但 SDK 没有声明它。这里只补最小面。

/** 高亮结果里的一个 token 树节点；文本节点是裸字符串。 */
interface IHljsNode {
    scope?: string;
    children?: (IHljsNode | string)[];
}

/** hljs 内部那个把 token 树渲染成 HTML 的 emitter。 */
interface IHljsEmitter {
    rootNode?: IHljsNode;
}

interface IHljsResult {
    value: string;
    language?: string;
    relevance?: number;
    /** hljs 没有写进文档的内部结构，仅供我们少走一趟 HTML。取不到时退回解析 value。 */
    _emitter?: IHljsEmitter;
}

interface IHljs {
    highlight(code: string, options: {language: string; ignoreIllegals?: boolean}): IHljsResult;
    getLanguage(name: string): unknown;
    listLanguages(): string[];
}

interface Window {
    hljs?: IHljs;
}
