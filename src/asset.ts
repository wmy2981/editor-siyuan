/**
 * 资源文件的定位、读取与写回。
 *
 * 链接形如 `assets/xxx.txt`，但它对应的磁盘位置并不固定：可能是全局的
 * `data/assets/`，也可能是旧结构下某个笔记本自己的 `data/<boxID>/assets/`，
 * 加密笔记本还会带 `?box=<boxID>` 查询串。所以定位交给内核：
 *   1. /api/asset/resolveAssetPath 拿到绝对路径，再相对工作区还原成 /data/... 形式；
 *   2. /api/asset/statAsset 拿到体积，在读之前就把超大文件挡掉（内核读文件是整体读入内存的，
 *      超限的文件一旦开始读就会占用等量内存，不能靠读到一半中止来兜底）。
 *
 * 编码固定按 UTF-8 读写，但保留原文件的 BOM 与换行风格：不然打开再保存一次，
 * 一个 CRLF 文件会被整体改写，diff 全红。
 */
import {baseName, config} from "./util";

const GET_FILE = "/api/file/getFile";
const PUT_FILE = "/api/file/putFile";
const RESOLVE_ASSET = "/api/asset/resolveAssetPath";
const STAT_ASSET = "/api/asset/statAsset";

const UTF8_BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);

interface IApiEnvelope<T> {
    code: number;
    msg: string;
    data: T;
}

/**
 * 用原生 fetch 而不是 SDK 的 fetchPost：宿主已经用 X-SiYuan-App-ID 包装过 window.fetch，
 * 插件直接调用文件接口同样会带上该头，而这里的 getFile 需要绕过 fetchPost 的文本化处理。
 * 401 时宿主会整页刷新，这里不跟：刷新会丢掉页签里未保存的内容，宁可报错。
 */
async function postJson<T>(url: string, body: unknown): Promise<IApiEnvelope<T>> {
    const response = await fetch(url, {method: "POST", body: JSON.stringify(body)});
    if (!response.ok) {
        throw new Error(`${url} HTTP ${response.status}`);
    }
    return await response.json() as IApiEnvelope<T>;
}

export interface IAssetRef {
    /** 规范化后的链接（去掉查询串与片段），同时用作页签键与语言记忆键。 */
    link: string;
    /** 工作区相对路径，如 /data/assets/xxx.txt。 */
    apiPath: string;
    size: number;
}

export interface IAssetText {
    /** 正文，换行统一为 \n。 */
    text: string;
    eol: "\n" | "\r\n";
    bom: boolean;
}

export type TResolveResult =
    | {kind: "ok"; ref: IAssetRef}
    | {kind: "error"; message: string};

/** 绝对路径 → 工作区相对路径；不在 workspace/data 之下时返回 undefined。 */
function toApiPath(absolute: string): string | undefined {
    const workspace = config().system?.workspaceDir;
    if (!workspace || !absolute) {
        return undefined;
    }
    const root = workspace.replaceAll("\\", "/").replace(/\/+$/, "");
    const normalized = absolute.replaceAll("\\", "/");
    if (!normalized.startsWith(`${root}/data/`)) {
        return undefined;
    }
    return normalized.slice(root.length);
}

/**
 * 定位资源。
 *
 * 仅接受 `assets/` 前缀的链接：工作区外的 `file://` 绝对路径不在本插件范围内，
 * 内核的 getFile / putFile 也只认工作区相对路径。
 */
export async function resolveAsset(link: string): Promise<TResolveResult> {
    if (!link.startsWith("assets/")) {
        return {kind: "error", message: "not an asset link"};
    }
    try {
        // 传原始链接：加密笔记本的 ?box=<boxID> 要靠内核自己解析
        const resolved = await postJson<string>(RESOLVE_ASSET, {path: link});
        if (resolved.code !== 0) {
            return {kind: "error", message: resolved.msg || `code ${resolved.code}`};
        }
        const apiPath = toApiPath(resolved.data);
        if (!apiPath) {
            // 加密笔记本的资源会被解析成 temp 下的明文副本，写回那份副本等于丢改动
            return {kind: "error", message: "encrypted or outside workspace"};
        }
        const stat = await postJson<{size: number}>(STAT_ASSET, {path: link});
        if (stat.code !== 0) {
            // 内核在这里用 code 1 表示资源定位不到
            return {kind: "error", message: stat.msg || `code ${stat.code}`};
        }
        return {kind: "ok", ref: {link: link.split("?")[0], apiPath, size: stat.data.size}};
    } catch (error) {
        return {kind: "error", message: error instanceof Error ? error.message : String(error)};
    }
}

export async function readAssetText(ref: IAssetRef): Promise<IAssetText> {
    const response = await fetch(GET_FILE, {method: "POST", body: JSON.stringify({path: ref.apiPath})});
    if (response.status !== 200) {
        // 失败走 202 + JSON 信封，成功才是裸字节
        let message = `HTTP ${response.status}`;
        try {
            message = ((await response.json()) as IApiEnvelope<null>).msg || message;
        } catch {
            // 非 JSON 响应时保留 HTTP 状态
        }
        throw new Error(message);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const bom = buffer.length >= 3 && buffer[0] === UTF8_BOM[0] && buffer[1] === UTF8_BOM[1] && buffer[2] === UTF8_BOM[2];
    const raw = new TextDecoder("utf-8").decode(bom ? buffer.subarray(3) : buffer);
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    // 编辑器内部统一用 \n；孤立 \r（老 Mac 换行）一并规整，避免它被当成普通字符
    return {text: raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n"), eol, bom};
}

/** 写回原文件。成功后返回 undefined，失败返回可展示的错误信息。 */
export async function writeAssetText(ref: IAssetRef, data: IAssetText): Promise<string | undefined> {
    const text = data.eol === "\r\n" ? data.text.replaceAll("\n", "\r\n") : data.text;
    const bytes = new TextEncoder().encode(text);
    const body = new FormData();
    body.append("path", ref.apiPath);
    body.append("isDir", "false");
    body.append("file", new Blob(data.bom ? [UTF8_BOM, bytes] : [bytes], {type: "text/plain"}), baseName(ref.apiPath));
    try {
        const response = await fetch(PUT_FILE, {method: "POST", body});
        const result = await response.json() as IApiEnvelope<null>;
        return result.code === 0 ? undefined : (result.msg || `code ${result.code}`);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}
