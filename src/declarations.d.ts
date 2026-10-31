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

/** 引擎里已注册的一门语言；别名与规范名指向同一个对象，见 language.ts。 */
interface IHljsLanguage {
    name?: string;
    aliases?: string[];
    /** 关键字定义：字符串、数组或按类别分组的对象，见 complete.ts。 */
    keywords?: unknown;
}

interface IHljs {
    highlight(code: string, options: {language: string; ignoreIllegals?: boolean}): IHljsResult;
    getLanguage(name: string): IHljsLanguage | undefined;
    listLanguages(): string[];
}

interface Window {
    hljs?: IHljs;
}

// uglify-js 与 csso 都不带类型声明，这里只补本插件用到的那两个入口。
// uglify-js 的 main 指向 Node 专用的 tools/node.js，浏览器入口是 tools/exports.js。
declare module "uglify-js/tools/exports.js" {
    interface IUglifyResult {
        code?: string;
        error?: Error;
    }

    function minify(code: string, options?: Record<string, unknown>): IUglifyResult;
}

declare module "csso" {
    interface ICssoResult {
        css: string;
    }

    function minify(source: string, options?: {restructure?: boolean}): ICssoResult;
}
