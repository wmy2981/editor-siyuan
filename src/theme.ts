/**
 * 让代码配色跟随用户的思源设置。
 *
 * 思源把用户选择的代码高亮主题做成了一个全局样式表：
 *   /stage/protyle/js/highlight.js/styles/<主题名>.min.css
 * 它被思源改写过——上游 `.hljs{background;color}` 被换成了全局的
 * `.code-block{background;color}`，token 规则（`.hljs-keyword` 之类）保持全局。
 * 只要我们的 DOM 里用了同样的类名，把同一份样式表挂进页面，配色就与思源代码块完全一致。
 *
 * 正因为它是全局的，插入位置决定了谁赢：思源自己那份由 addStyle 插在 `#pluginsStyle` 之前，
 * 我们也必须挤进同一个位置。排到 head 末尾是错的——那时 `.code-block{background;color}`
 * 会连思源代码块的背景与配色一起压掉，而且压住的是插件加载那一刻的主题：用户之后切亮暗，
 * 思源改的是它自己那份，改不动我们这份。
 *
 * 所以我们这份只是兜底。插件 onload 时思源还没加载外观资源，`#protyleHljsStyle` 尚不存在；
 * 思源一旦插上自己那份就永远排在我们后面，配色由它说了算。
 *
 * 不复用思源那个 `<link id="protyleHljsStyle">`：思源切换主题时会 remove 掉它
 * 再重新插入，我们跟着它会被一起摘掉。
 */
import type {Plugin} from "siyuan";
import {config} from "./util";

const HLJS_CDN = "/stage/protyle/js/highlight.js";
const HLJS_VERSION = "11.12.0";
const LINK_ID = "editor-siyuan-hljsStyle";
const SIYUAN_LINK_ID = "protyleHljsStyle";
const PLUGINS_STYLE_ID = "pluginsStyle";

const FALLBACK_LIGHT = "default";
const FALLBACK_DARK = "github-dark";

/** 只关心这三项：外观推送与 `window.siyuan.config.appearance` 都是这个形状。 */
interface ICodeThemeSource {
    mode?: number;
    codeBlockThemeLight?: string;
    codeBlockThemeDark?: string;
}

/**
 * 插到思源自己那份的位置上，让它永远排在我们后面。
 *
 * 思源的 addStyle 把 `#protyleHljsStyle` 插在 `#pluginsStyle` 之前，这里照抄这个位置；
 * 它已经存在时必须插在它前面，否则会插到它和 `#pluginsStyle` 中间，反而压住它。
 */
function insertLink(link: HTMLLinkElement): void {
    const anchor = document.getElementById(SIYUAN_LINK_ID) ?? document.getElementById(PLUGINS_STYLE_ID);
    if (anchor) {
        anchor.before(link);
    } else {
        document.head.append(link);
    }
}

/**
 * 思源自己用硬编码白名单校验主题名，这里改为按加载结果回退。
 * 白名单会随版本增删，而 onerror 既能挡住失效的主题名，也能接受未来新增的主题。
 */
function applyTheme(name: string, fallback: string): void {
    const href = `${HLJS_CDN}/styles/${name}.min.css?v=${HLJS_VERSION}`;
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
        link = document.createElement("link");
        link.id = LINK_ID;
        link.rel = "stylesheet";
        insertLink(link);
    }
    if (link.href.includes(href)) {
        return;
    }
    link.onerror = () => {
        link!.onerror = null;
        if (name !== fallback) {
            applyTheme(fallback, fallback);
        }
    };
    link.href = href;
}

function applyAppearance(source: ICodeThemeSource): void {
    if (source.mode === 0) {
        applyTheme(source.codeBlockThemeLight || FALLBACK_LIGHT, FALLBACK_LIGHT);
    } else {
        applyTheme(source.codeBlockThemeDark || FALLBACK_DARK, FALLBACK_DARK);
    }
}

export function syncCodeTheme(): void {
    applyAppearance(config().appearance);
}

/**
 * 订阅外观变更。
 *
 * 外观变更推的是 `setAppearance`，不是 `setConf`（后者只覆盖编辑器、导出这类设置）。
 * 而且思源先把这个事件派发给插件、之后才把新外观写进 `window.siyuan.config`，
 * 所以这里只能读事件里那份外观对象——读全局配置拿到的是切换前的旧值。
 */
export function watchCodeTheme(plugin: Plugin): void {
    syncCodeTheme();
    plugin.eventBus.on("ws-main", (event: CustomEvent<{cmd?: string; data?: ICodeThemeSource}>) => {
        const detail = event.detail;
        if (detail?.cmd === "setAppearance" && typeof detail.data?.mode === "number") {
            applyAppearance(detail.data);
        }
    });
}
