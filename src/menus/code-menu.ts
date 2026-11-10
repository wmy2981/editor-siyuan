/**
 * 笔记里代码块菜单中的格式化与压缩。
 *
 * 入口是 click-blockicon：代码块右上角的「更多」按钮同样交给 gutter.renderMenu
 * （protyle/wysiwyg/index.ts 把 .protyle-action__menu 交给它），与块图标右键是同一个事件，
 * 宿主把这些项统一包进 id 为 plugin 的「插件」子菜单。
 *
 * 写回走思源自己的事务：先把新正文写进代码块的 DOM，再用 protyle.updateTransactionElement
 * 提交——与在编辑器里直接改代码块是同一条路。于是撤销栈、滚动位置都归思源管，
 * 块上原有的属性（换行、连字、行号、Tab 空格数）也随 DOM 一起原样带回。
 * 代价是这类本地事务刻意保留现有 DOM（Constants.ATTRIBUTE_EDITING，为的是不打断正在输入的
 * 光标），思源不会替我们重新高亮，所以要自己调一次 ProtyleMethod.highlightRender——
 * 它顺带把行号列重算，并把光标按偏移量放回代码里。
 *
 * 代码块没有文件名，而 prettier 要靠扩展名区分 .ts 与 .tsx、json 与 json5 这类细分格式，
 * 所以按思源的代码块语言补一个扩展名，之后的判断与页签里那两项完全共用（见 format.ts）。
 */
import {ProtyleMethod, showMessage, type IProtyle, type Plugin, type subMenu} from "siyuan";
import {canFormat, canMinify, formatText, minifyText} from "../format/format";
import {prepareFormat} from "../format/prettier-config";
import {debug} from "../core/debug";
import {guessLanguage} from "../files/language";
import {ICON_TAB} from "../core/icons";
import type {Settings} from "../core/config";
import type {T} from "../i18n";

export interface ICodeMenuDeps {
    plugin: Plugin;
    t: T;
    settings: () => Settings;
}

/**
 * 思源的代码块语言（操作条上那个标签）→ 合成文件名用的扩展名。
 * 表里没有的语言本插件没有实现，菜单里不出现这两项。
 */
const CODE_EXTENSIONS: Record<string, string> = {
    js: ".js", javascript: ".js", mjs: ".js", cjs: ".js",
    jsx: ".jsx",
    ts: ".ts", typescript: ".ts", mts: ".ts", cts: ".ts",
    tsx: ".tsx",
    json: ".json", jsonc: ".jsonc", json5: ".json5",
    css: ".css", scss: ".scss", sass: ".scss", less: ".less",
    html: ".html", htm: ".html", xml: ".xml", vue: ".vue", svelte: ".svelte",
    yaml: ".yaml", yml: ".yaml", markdown: ".md", md: ".md",
};

/** 代码块对应的 hljs 语言与合成链接；语言不在表里时返回 undefined。 */
interface ITarget {
    language: string;
    link: string;
}

function targetOf(language: string): ITarget | undefined {
    const extension = CODE_EXTENSIONS[language.trim().toLowerCase()];
    if (!extension) {
        return undefined;
    }
    // 链接只为给 prettier 提供扩展名，guessLanguage 反过来定 hljs 语言，两边用的是同一张表
    const link = `code${extension}`;
    return {language: guessLanguage(link), link};
}

/**
 * 思源代码块的正文惯例是以换行结尾（highlightRender 也这么补），写回时对齐它。
 * 顺带让「已经格式化过」与「已经压缩过」这两种情况能与现有正文逐字比较。
 */
const withTrailingNewline = (text: string): string => text.endsWith("\n") ? text : `${text}\n`;

function addItems(
    deps: ICodeMenuDeps,
    menu: subMenu,
    protyle: IProtyle,
    block: HTMLElement,
    container: HTMLElement,
    body: Element,
    target: ITarget,
): void {
    const t = deps.t;
    const run = (kind: "format" | "minify"): void => {
        void (async () => {
            const text = body.textContent ?? "";
            try {
                // 代码块没有文件路径，所以不查 .prettierignore，只吃配置里的选项
                const next = kind === "format"
                    ? await formatText(target.language, target.link, text, await prepareFormat(t))
                    : await minifyText(target.language, target.link, text);
                const out = withTrailingNewline(next);
                if (!block.isConnected) {
                    // 计算期间文档被切走或这个块被删掉了
                    debug(`${kind} discarded`, {link: target.link, reason: "the block is gone"});
                    return;
                }
                if (out === text) {
                    debug(`${kind} skipped`, {link: target.link, reason: "already in that shape"});
                    return;
                }
                // 事务按 DOM 序列化，所以先把新正文写回块里，再提交
                const oldHTML = block.outerHTML;
                body.textContent = out;
                // 去掉 data-render，否则下面的重新高亮会被它跳过
                container.removeAttribute("data-render");
                protyle.getInstance().updateTransactionElement(block, oldHTML);
                // 本地事务保留现有 DOM，思源不会重新高亮，这一步得自己做
                ProtyleMethod.highlightRender(block);
                debug(`${kind} done`, {link: target.link, from: text.length, to: out.length});
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                debug(`${kind} failed`, {link: target.link, message});
                showMessage(`${t(kind === "format" ? "formatFailed" : "minifyFailed")}: ${message}`, 6000, "error");
            }
        })();
    };

    // 只读文档里两项都留着但置灰：菜单项消失会让人以为插件没装
    const readOnly = protyle.disabled;
    menu.addItem({
        id: "editorSiyuanFormat",
        label: t("formatCode"),
        icon: ICON_TAB,
        disabled: readOnly || !canFormat(target.language, target.link),
        click: () => run("format"),
    });
    menu.addItem({
        id: "editorSiyuanMinify",
        label: t("minifyCode"),
        icon: ICON_TAB,
        disabled: readOnly || !canMinify(target.language, target.link),
        click: () => run("minify"),
    });
}

export function registerCodeMenu(deps: ICodeMenuDeps): void {
    deps.plugin.eventBus.on("click-blockicon", (event) => {
        if (!deps.settings().codeBlockMenu) {
            return;
        }
        const {menu, protyle, blockElements} = event.detail;
        // 多选时 blockElements 是一批块，这里只处理单个代码块
        const block = blockElements?.length === 1 ? blockElements[0] : undefined;
        if (!block || block.getAttribute("data-type") !== "NodeCodeBlock") {
            return;
        }
        // 语言只在代码块的围栏信息里，DOM 上要看操作条那个标签——思源各处也都是这么取的。
        // 注意不能读 data-subtype：普通代码块没有这个属性，它是渲染成图表的那几种
        // （mermaid、echarts 之类）才带的标记。
        const language = block.querySelector(".protyle-action__language")?.textContent?.trim() ?? "";
        const target = targetOf(language);
        // 正文是 .hljs 的最后一个子元素，前面那个是行号列（思源取可编辑元素时也是这么取的）。
        // 不用 [contenteditable="true"]：只读文档里思源会把它们全改成 false，行号列更是排在前面。
        const container = block.querySelector<HTMLElement>(".hljs");
        const body = container?.lastElementChild;
        debug("click-blockicon", {language, supported: !!target, body: !!body});
        if (!container || !body || !target) {
            // 没选语言的代码块、以及渲染成图表的代码块都没有可改的正文
            return;
        }
        addItems(deps, menu, protyle, block, container, body, target);
    });
}
