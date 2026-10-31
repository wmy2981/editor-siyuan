/**
 * 代码提示（自动补全）。
 *
 * 候选只有两个来源，都复用已经加载的东西，不额外打包语言包：
 * - 当前语言的关键字：从思源那份 highlight.js 的语言定义里取，不需要语法树；
 * - 文档里的词：@codemirror/autocomplete 自带的 completeAnyWord，扫描光标前最多 5 万字符。
 *
 * 没有语法树，所以补全只到词级：没有类型信息、成员补全或跳转定义（issue #28 的边界）。
 * 两份候选合成一个来源、同一个词只留一条：否则文档里出现过的关键字会在列表里重复一次。
 */
import {
    autocompletion,
    completeAnyWord,
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
} from "@codemirror/autocomplete";
import type {EditorState, Extension} from "@codemirror/state";

/** 光标前的标识符：字母、下划线、美元符号开头，后面可以跟数字。 */
const WORD = /[A-Za-z_$][\w$]*/;

/**
 * 关键字定义的归一化。
 *
 * hljs 的关键字有三种形态：空格分隔的字符串、数组、按类别分组的对象
 * （`{keyword, built_in, literal}`）。`$pattern` 是给词法分析器用的正则，不是关键字。
 */
export function keywordList(raw: unknown): string[] {
    if (typeof raw === "string") {
        return raw.split(/\s+/).filter((word) => word !== "");
    }
    if (Array.isArray(raw)) {
        return raw.flatMap((item) => keywordList(item));
    }
    if (raw !== null && typeof raw === "object") {
        return Object.entries(raw)
            .filter(([key]) => key !== "$pattern")
            .flatMap(([, value]) => keywordList(value));
    }
    return [];
}

/** 每门语言只解析一次；键是 hljs 的语言定义对象，引擎重新加载后自然失效。 */
const cache = new WeakMap<object, Completion[]>();

function keywordsFor(language: string): Completion[] {
    const definition = window.hljs?.getLanguage(language);
    if (!definition) {
        return [];
    }
    let options = cache.get(definition);
    if (!options) {
        const labels = new Set(keywordList(definition.keywords));
        options = Array.from(labels, (label) => ({label, type: "keyword"}));
        cache.set(definition, options);
    }
    return options;
}

/**
 * 关键字候选。
 *
 * 只有光标在标识符上、或用户手动触发（Ctrl-Space）时才给：否则每敲一个空格都会弹出
 * 整张关键字表。候选按已输入的前缀先筛一遍，列表不必交给 CodeMirror 再从几百项里过滤。
 */
function keywordResult(context: CompletionContext, language: string): CompletionResult | null {
    const word = context.matchBefore(WORD);
    if (!word && !context.explicit) {
        return null;
    }
    const from = word ? word.from : context.pos;
    const typed = context.state.sliceDoc(from, context.pos);
    const options = keywordsFor(language).filter((option) => option.label.startsWith(typed));
    return options.length > 0 ? {from, options, validFor: /^[\w$]*$/} : null;
}

/** 合并两份候选；`from` 不一致时说明两边对词边界看法不同，交给更通用的文档词。 */
function merge(keyword: CompletionResult | null, words: CompletionResult | null): CompletionResult | null {
    if (!keyword) {
        return words;
    }
    if (!words) {
        return keyword;
    }
    if (words.from !== keyword.from) {
        return words;
    }
    const labels = new Set(keyword.options.map((option) => option.label));
    return {
        from: words.from,
        options: [...keyword.options, ...words.options.filter((option) => !labels.has(option.label))],
        validFor: words.validFor,
    };
}

/** 代码提示扩展；`languageOf` 由编辑器给出当前语言（存在高亮状态里）。 */
export function autocompleteExtensions(languageOf: (state: EditorState) => string): Extension {
    const source: CompletionSource = (context) => {
        const keyword = keywordResult(context, languageOf(context.state));
        const words = completeAnyWord(context);
        return words instanceof Promise
            ? words.then((resolved) => merge(keyword, resolved))
            : merge(keyword, words);
    };
    return autocompletion({override: [source]});
}
