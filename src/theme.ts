/**
 * 让代码配色跟随用户的思源设置。
 *
 * 思源把用户选择的代码高亮主题做成了一个全局样式表：
 *   /stage/protyle/js/highlight.js/styles/<主题名>.min.css
 * 它被思源改写过——上游 `.hljs{background;color}` 被拆成了 `.hljs{...}` 与
 * `.code-block{background;color}`，token 规则（`.hljs-keyword` 之类）保持全局。
 * 只要我们的 DOM 里用了同样的 `.code-block` / `.hljs` 类名，把同一份样式表挂进页面，
 * 配色就与思源代码块完全一致，且用户换主题、切亮暗都会同步生效。
 *
 * 不复用思源那个 `<link id="protyleHljsStyle">`：思源切换主题时会 remove 掉它
 * 再重新插入，我们跟着它会被一起摘掉。
 */
import type {Plugin} from "siyuan";
import {config} from "./util";

const HLJS_CDN = "/stage/protyle/js/highlight.js";
const HLJS_VERSION = "11.12.0";
const LINK_ID = "editor-siyuan-hljsStyle";

const FALLBACK_LIGHT = "default";
const FALLBACK_DARK = "github-dark";

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
        document.head.append(link);
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

export function syncCodeTheme(): void {
    const appearance = config().appearance;
    if (appearance.mode === 0) {
        applyTheme(appearance.codeBlockThemeLight || FALLBACK_LIGHT, FALLBACK_LIGHT);
    } else {
        applyTheme(appearance.codeBlockThemeDark || FALLBACK_DARK, FALLBACK_DARK);
    }
}

/**
 * 订阅配置变更。
 *
 * 外观设置走本地的 applyAppearanceConfig，不保证推送 setConf，所以除了这里订阅，
 * 每次打开页签也会再校正一次。
 */
export function watchCodeTheme(plugin: Plugin): void {
    syncCodeTheme();
    plugin.eventBus.on("ws-main", (event: CustomEvent<{ cmd?: string }>) => {
        if (event.detail?.cmd === "setConf") {
            syncCodeTheme();
        }
    });
}
