/**
 * 文件 → 图标。
 *
 * 图标来自 VS Code 默认的 Seti 文件图标主题（见 file-icons.ts），解析顺序与 VS Code 一致：
 * 文件名 → 扩展名（从最长的复合扩展名开始试） → 语言。都认不出来时回退插件自己的图标。
 */
import {FILE_ICON_BY_EXTENSION, FILE_ICON_BY_LANGUAGE, FILE_ICON_BY_NAME} from "./file-icons";
import {ICON_TAB} from "./icons";
import {guessLanguage} from "./language";
import {baseName, stripQuery} from "./util";

/**
 * hljs 语言标识 → VS Code 语言标识。
 *
 * 只列 VS Code 按语言（而不是扩展名）解析图标的那些：.js、.py、.sql 这类扩展名
 * 在 Seti 主题里没有条目，靠语言落到图标。scala、nim、zig、graphql 等语言在 Seti 的
 * languageIds 里也没有，但它们的扩展名有条目，所以不在这里重复。
 */
const VSCODE_LANGUAGE: Record<string, string> = {
    bash: "shellscript",
    c: "c",
    clojure: "clojure",
    cpp: "cpp",
    csharp: "csharp",
    css: "css",
    dart: "dart",
    dos: "bat",
    elixir: "elixir",
    go: "go",
    groovy: "groovy",
    haskell: "haskell",
    html: "html",
    // Seti 的 languageIds 里没有 ini；借 dotenv 的配置图标，
    // 免得 .ini / .cfg / .conf / .env 这些文件全部回退到插件图标
    ini: "dotenv",
    java: "java",
    javascript: "javascript",
    json: "json",
    julia: "julia",
    kotlin: "kotlin",
    latex: "latex",
    less: "less",
    lua: "lua",
    markdown: "markdown",
    objectivec: "objective-c",
    ocaml: "ocaml",
    perl: "perl",
    php: "php",
    powershell: "powershell",
    properties: "properties",
    python: "python",
    r: "r",
    ruby: "ruby",
    rust: "rust",
    scss: "scss",
    sql: "sql",
    swift: "swift",
    typescript: "typescript",
    xml: "xml",
    yaml: "yaml",
};

/**
 * 无扩展名、但 VS Code 有明确语言归属的文件名。
 * guessLanguage 只认扩展名，这些要单独补。
 */
const LANGUAGE_BY_NAME: Record<string, string> = {
    ".gitignore": "ignore",
    ".prettierignore": "ignore",
    "dockerfile": "dockerfile",
    "gnumakefile": "makefile",
    "makefile": "makefile",
    // Ruby 工具链里约定俗成的无扩展名文件
    "berksfile": "ruby",
    "brewfile": "ruby",
    "gemfile": "ruby",
    "podfile": "ruby",
    "rakefile": "ruby",
    "vagrantfile": "ruby",
};

/**
 * 扩展名 → 图标，绕过生成出来的 Seti 映射表。
 *
 * jsx/tsx：VS Code 按 languageId 取 React 图标，而 hljs 把这两个扩展名归进
 * javascript/typescript，所以要单独指过去。
 *
 * sy：思源自己的文档格式，用思源的默认文档图标 iconFile——它就是文件树里没有自定义
 * 图标的文档显示的那个（appearance/icons/litheness，emoji/fileTreeIcon.ts 的 file 项）。
 * 符号由思源自己注册，这里只引用，不需要 addIcons。
 */
const EXTRA_EXTENSION_ICONS: Record<string, string> = {
    jsx: FILE_ICON_BY_LANGUAGE.javascriptreact,
    tsx: FILE_ICON_BY_LANGUAGE.typescriptreact,
    sy: "iconFile",
};

/**
 * 取一个文件对应的图标 symbol id。
 *
 * 参数可以是资源链接（assets/a.ts）、工作区路径（/data/box/a.ts）或纯文件名；
 * 查询串与片段会被忽略，大小写不敏感。
 */
export function fileIcon(path: string): string {
    const name = baseName(stripQuery(path)).toLowerCase();
    const byName = FILE_ICON_BY_NAME[name];
    if (byName) {
        return byName;
    }
    // 复合扩展名优先：a.spec.ts 先试 spec.ts，再试 ts
    for (let dot = name.indexOf("."); dot >= 0; dot = name.indexOf(".", dot + 1)) {
        const extension = name.slice(dot + 1);
        const byExtension = FILE_ICON_BY_EXTENSION[extension] ?? EXTRA_EXTENSION_ICONS[extension];
        if (byExtension) {
            return byExtension;
        }
    }
    const language = LANGUAGE_BY_NAME[name] ?? VSCODE_LANGUAGE[guessLanguage(name)];
    return (language && FILE_ICON_BY_LANGUAGE[language]) || ICON_TAB;
}

/**
 * 换掉页签头上的图标。
 *
 * 宿主没有更新图标的公开方法（Tab 只有 updateTitle），但 icon 字段与头部的 <use> 都是公开的；
 * 切换文件时两者一起改，页签图标才不会停在打开时那个文件上。
 */
export function updateTabIcon(
    tab: {icon: string; headElement: HTMLElement} | undefined,
    icon: string,
): void {
    if (!tab || tab.icon === icon) {
        return;
    }
    tab.icon = icon;
    const use = tab.headElement.querySelector("use");
    use?.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${icon}`);
}
