/**
 * 代码格式化与压缩。
 *
 * 格式化交给 prettier 的 standalone 构建：它在浏览器里可用，只需要按语言给出 parser。
 * 压缩没有统一实现，按语言分别处理：
 * - JSON：JSON.parse + stringify，结果精确；
 * - JavaScript：uglify-js 的浏览器入口（tools/exports.js，不依赖 fs）；
 * - CSS：csso，关掉 restructure——它会合并、重排规则，改动范围超出「压缩」。
 * 其余语言（TypeScript、JSX、SCSS、LESS、HTML、YAML、Markdown）在浏览器里没有可靠的
 * 压缩实现，所以只提供格式化，菜单里那一项会置灰。
 *
 * 所有失败都抛错，由调用方展示；错误信息保留 prettier / uglify 的原文（含行列号）。
 */
import * as prettier from "prettier/standalone";
import * as prettierEstree from "prettier/plugins/estree";
import * as prettierBabel from "prettier/plugins/babel";
import * as prettierTypescript from "prettier/plugins/typescript";
import * as prettierPostcss from "prettier/plugins/postcss";
import * as prettierHtml from "prettier/plugins/html";
import * as prettierYaml from "prettier/plugins/yaml";
import * as prettierMarkdown from "prettier/plugins/markdown";
import {minify as uglify} from "uglify-js/tools/exports.js";
import {minify as csso} from "csso";
import {extensionOf} from "../core/config";
import {baseName} from "../core/util";

/** prettier 的插件表；prettier 自己按 parser 名字挑，所以一次给全。 */
const PLUGINS = [
    prettierEstree,
    prettierBabel,
    prettierTypescript,
    prettierPostcss,
    prettierHtml,
    prettierYaml,
    prettierMarkdown,
];

/** prettier.format 的选项类型；standalone 入口没有单独导出它。 */
type TFormatOptions = NonNullable<Parameters<typeof prettier.format>[1]>;

/**
 * hljs 语言 → prettier parser。
 *
 * 扩展名用来区分同一门语言下的细分格式：`.json5` 要保住它自己的写法（不加引号的键），
 * `.vue` 要用 vue 解析器，`.svelte` 干脆不给——prettier 没有 svelte 解析器，
 * 交给 html 解析器只会把模板当纯文本重排。
 */
function parserFor(language: string, extension: string): string | undefined {
    switch (language) {
        case "javascript":
            return "babel";
        case "typescript":
            return "typescript";
        case "json":
            return extension === ".json5" ? "json5" : "json";
        case "css":
            return "css";
        case "scss":
            return "scss";
        case "less":
            return "less";
        case "xml":
        // html 是 xml 的别名（见 language.ts）：.html 文件现在报 html，解析器仍是同一个
        case "html":
            if (extension === ".svelte") {
                return undefined;
            }
            return extension === ".vue" ? "vue" : "html";
        case "yaml":
            return "yaml";
        case "markdown":
            return "markdown";
        default:
            return undefined;
    }
}

/**
 * 去掉 JSONC 的注释，字符串里的斜杠与转义不动。
 * JSON.parse 不认注释，而 `.jsonc` 里注释很常见，压缩前必须先剥掉。
 */
function stripJsonComments(text: string): string {
    let out = "";
    let inString = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            out += char;
            if (char === "\\") {
                out += text[index + 1] ?? "";
                index++;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            out += char;
        } else if (char === "/" && text[index + 1] === "/") {
            while (index < text.length && text[index] !== "\n") {
                index++;
            }
            out += "\n";
        } else if (char === "/" && text[index + 1] === "*") {
            index += 2;
            while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
                index++;
            }
            index++;
        } else {
            out += char;
        }
    }
    return out;
}

/** 去掉尾随逗号：JSONC 允许，JSON.parse 不允许。传入的文本已经不含注释。 */
function stripTrailingCommas(text: string): string {
    let out = "";
    let inString = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            out += char;
            if (char === "\\") {
                out += text[index + 1] ?? "";
                index++;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
        } else if (char === ",") {
            let next = index + 1;
            while (next < text.length && /\s/.test(text[next])) {
                next++;
            }
            if (text[next] === "}" || text[next] === "]") {
                continue;
            }
        }
        out += char;
    }
    return out;
}

function minifyJson(text: string): string {
    return JSON.stringify(JSON.parse(stripTrailingCommas(stripJsonComments(text))));
}

function minifyJavaScript(text: string): string {
    const result = uglify(text);
    if (result.error) {
        throw result.error;
    }
    if (!result.code) {
        throw new Error("uglify-js produced no output");
    }
    return result.code;
}

function minifyCss(text: string): string {
    return csso(text, {restructure: false}).css;
}

/**
 * hljs 语言 → 压缩实现。
 *
 * `.json5` 不是 JSON（键可以不加引号、字符串可以用单引号），JSON.parse 处理不了；
 * `.jsx` 会被 uglify-js 直接判成语法错误。这两种情况不给压缩，菜单里置灰。
 */
function minifierFor(language: string, extension: string): ((text: string) => string) | undefined {
    switch (language) {
        case "json":
            return extension === ".json5" ? undefined : minifyJson;
        case "javascript":
            return extension === ".jsx" ? undefined : minifyJavaScript;
        case "css":
            return minifyCss;
        default:
            return undefined;
    }
}

/** 当前语言 + 扩展名是否有格式化实现。 */
export const canFormat = (language: string, link: string): boolean =>
    parserFor(language, extensionOf(link)) !== undefined;

/** 当前语言 + 扩展名是否有压缩实现。 */
export const canMinify = (language: string, link: string): boolean =>
    minifierFor(language, extensionOf(link)) !== undefined;

/**
 * 格式化整篇正文，返回新正文。
 *
 * 选项全部来自用户的 prettier 配置文件（见 prettier-config.ts）：插件不再在代码里兜一套缩进，
 * 默认值已经随配置文件落盘，改与不改都在那一个文件里。`parser` 与 `plugins` 由语言决定，
 * 配置改不动。
 */
export async function formatText(
    language: string,
    link: string,
    text: string,
    options: Record<string, unknown> = {},
): Promise<string> {
    const parser = parserFor(language, extensionOf(link));
    if (!parser) {
        throw new Error(`no formatter for ${language}`);
    }
    const formatOptions = {
        ...options,
        parser,
        plugins: PLUGINS,
    } as TFormatOptions;
    if (parser === "typescript") {
        // .tsx 与 .ts 是两套语法（泛型箭头函数与 JSX 冲突），只能靠文件名区分
        formatOptions.filepath = baseName(link);
    }
    return await prettier.format(text, formatOptions);
}

/** 压缩整篇正文，返回新正文。实现是同步的，接口与 formatText 保持一致。 */
export async function minifyText(language: string, link: string, text: string): Promise<string> {
    const minify = minifierFor(language, extensionOf(link));
    if (!minify) {
        throw new Error(`no minifier for ${language}`);
    }
    return minify(text);
}
