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
