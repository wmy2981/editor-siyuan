/** 通用小工具。 */
import type {ISiyuan} from "siyuan";

/**
 * 取思源的运行时配置。
 *
 * `window.siyuan.config` 在类型上是可选的——发布页、集市等前端确实没有它。
 * 本插件声明为桌面端专属（plugin.json 的 frontends），运行到这里必然存在，
 * 所以在这个唯一出口断言一次，而不是在十几处调用点各写一个非空断言。
 */
export const config = (): NonNullable<ISiyuan["config"]> => window.siyuan.config!;

const ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
};

/** 拼 HTML 片段时的转义：思源的 UI 都走 innerHTML，必须自己转义外部字符串。 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

/** 取路径末段。传入的一定是 `assets/xxx.txt` 这类以 `/` 分隔的链接。 */
export function baseName(path: string): string {
    const index = path.lastIndexOf("/");
    return index < 0 ? path : path.slice(index + 1);
}

/** 从 `path` 或 `path?query#hash` 里取不含查询串与片段的部分。 */
export function stripQuery(path: string): string {
    const cut = path.search(/[?#]/);
    return cut < 0 ? path : path.slice(0, cut);
}

/**
 * 写入剪贴板。
 *
 * 先走异步剪贴板：它只在安全上下文（Electron、HTTPS、localhost）里存在，
 * 局域网 http 访问时没有它，退回一个临时 textarea 加 execCommand——思源自己
 * 在非安全上下文里也是这么做的。返回是否写入成功。
 */
export async function writeClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 权限被拒或窗口失焦：退回下面的兜底
        }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    // 不能用 fn__none 或 display:none：不可见元素选不中，execCommand 会失败
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}
