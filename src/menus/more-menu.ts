/**
 * 操作条右上角的「更多」菜单。
 *
 * 和编辑器右键菜单一样用思源原生的 Menu（宿主负责圆角、阴影、悬停色、禁用态）。
 * 分组与图标对齐思源的块菜单：同类动作之间不插分隔线，不同类之间插一条；
 * 有内置图标的用内置图标，没有的（格式化、压缩）交给宿主留一个空图标位，
 * 否则那两项的文字会比上面几项左移一截。
 *
 * 复制两项不改正文，预览（只读）模式下也能用；格式化与压缩会改动正文，所以只读时置灰。
 * 当前语言没有对应实现时同样置灰：格式化靠 prettier 的 parser，压缩只有 JSON、
 * JavaScript 与 CSS。
 */
import {Menu, showMessage} from "siyuan";
import type {EditorView} from "@codemirror/view";
import {absolutePath} from "../files/asset";
import {canFormat, canMinify, formatText, minifyText} from "../format/format";
import {prepareFormat} from "../format/prettier-config";
import {debug} from "../core/debug";
import {writeClipboard} from "../core/util";
import type {T} from "../i18n";

export interface IMoreMenuDeps {
    view: EditorView;
    /** 当前语法高亮语言（hljs 标识）。 */
    language: string;
    /** 资源链接，用来取扩展名。 */
    link: string;
    /** 工作区相对路径，如 /data/assets/xxx.txt；复制文件路径用它。 */
    apiPath: string;
    readOnly: boolean;
    t: T;
}

export function openMoreMenu(deps: IMoreMenuDeps, x: number, y: number): void {
    const {view, language, link, apiPath, readOnly, t} = deps;

    const run = (kind: "format" | "minify"): void => {
        void (async () => {
            const doc = view.state.doc;
            const text = doc.toString();
            try {
                let next: string;
                if (kind === "format") {
                    // 自定义配置与 .prettierignore 只影响格式化，压缩不读它们
                    const options = await prepareFormat(t, apiPath);
                    if (!options) {
                        debug("format skipped", {link, reason: "listed in .prettierignore"});
                        showMessage(t("prettierIgnored"), 4000);
                        return;
                    }
                    next = await formatText(language, link, text, options);
                } else {
                    next = await minifyText(language, link, text);
                }
                if (view.state.doc !== doc) {
                    // 计算期间用户敲过字：放弃这次结果，不能覆盖掉刚输入的内容
                    debug(`${kind} discarded`, {link, reason: "document changed while running"});
                    return;
                }
                // 整篇替换：撤销栈里只有一步，用户可以一次撤销回去
                view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: next}});
                debug(`${kind} done`, {link, language, from: text.length, to: next.length});
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                debug(`${kind} failed`, {link, language, message});
                showMessage(`${t(kind === "format" ? "formatFailed" : "minifyFailed")}: ${message}`, 6000, "error");
            }
        })();
    };

    /** 写剪贴板并反馈：失败要说出来，静默失败会让人以为复制好了。 */
    const copy = (text: string, what: string): void => {
        void writeClipboard(text).then((ok) => {
            debug(`copy ${what}`, {link, length: text.length, ok});
            if (ok) {
                showMessage(t("copied"), 2000);
            } else {
                showMessage(t("copyFailed"), 6000, "error");
            }
        });
    };

    const menu = new Menu();
    menu.addItem({
        id: "copy",
        icon: "iconCopy",
        label: t("copy"),
        click: () => copy(view.state.doc.toString(), "document"),
    });
    menu.addItem({
        id: "copyPath",
        icon: "iconCopy",
        label: t("copyFilePath"),
        click: () => {
            // 工作区位置拿不到时（浏览器前端）退回工作区相对路径，至少是完整可用的标识
            void absolutePath(apiPath).then((absolute) => copy(absolute ?? apiPath, "path"));
        },
    });

    menu.addSeparator();
    menu.addItem({
        id: "format",
        label: t("formatCode"),
        disabled: readOnly || !canFormat(language, link),
        click: () => run("format"),
    });
    menu.addItem({
        id: "minify",
        label: t("minifyCode"),
        disabled: readOnly || !canMinify(language, link),
        click: () => run("minify"),
    });
    menu.open({x, y, isLeft: true});
}
