/**
 * highlight.js 引擎加载。
 *
 * 思源只在真正渲染代码块时才用 addScript 注入 highlight.min.js，
 * 所以插件不能假定启动时 `window.hljs` 已经存在。
 *
 * 这里刻意复用思源那一份：`/stage/protyle/js/highlight.js/` 下的文件就是思源代码块
 * 用的同一个版本与同一批语言，复用之后我们的 token 分类与思源代码块逐字一致，
 * 也不必把 hljs 打进插件包。代价是依赖这个内部静态路径，脚本加载失败时降级为纯文本。
 */

const HLJS_CDN = "/stage/protyle/js/highlight.js";
// 与思源 constants 无关：思源在 highlightRender.ts 里写死了这两个查询串版本号
const HLJS_VERSION = "11.12.0";
const HLJS_THIRD_VERSION = "2.0.1";
const HLJS_SCRIPT_ID = "editor-siyuan-hljsScript";
const HLJS_THIRD_SCRIPT_ID = "editor-siyuan-hljsThirdScript";

let pending: Promise<boolean> | undefined;

function injectScript(src: string, id: string): Promise<boolean> {
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.addEventListener("load", () => {
            script.id = id;
            resolve(true);
        });
        script.addEventListener("error", () => {
            script.remove();
            resolve(false);
        });
        document.head.append(script);
    });
}

/** 确认 highlight.js 可用。并发调用共用同一个 Promise。 */
export function loadHljs(): Promise<boolean> {
    if (window.hljs) {
        return Promise.resolve(true);
    }
    if (!pending) {
        pending = injectScript(`${HLJS_CDN}/highlight.min.js?v=${HLJS_VERSION}`, HLJS_SCRIPT_ID)
            .then((ok) => ok && injectScript(`${HLJS_CDN}/third-languages.js?v=${HLJS_THIRD_VERSION}`, HLJS_THIRD_SCRIPT_ID))
            .then((ok) => {
                if (!ok || !window.hljs) {
                    // 失败时清空，下次打开页签再试一次
                    pending = undefined;
                    return false;
                }
                return true;
            });
    }
    return pending;
}
