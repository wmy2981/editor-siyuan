// 思源在渲染代码块时用 addScript 注入 highlight.js，脚本顶部是 `var hljs = ...`，
// 因此它在页面上是一个真实可用的全局对象，但 SDK 没有声明它。这里只补最小面。
interface IHljsResult {
    value: string;
    language?: string;
    relevance?: number;
}

interface IHljs {
    highlight(code: string, options: {language: string; ignoreIllegals?: boolean}): IHljsResult;
    getLanguage(name: string): unknown;
    listLanguages(): string[];
}

interface Window {
    hljs?: IHljs;
}
