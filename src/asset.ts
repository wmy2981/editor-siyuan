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
const WORKSPACE_INFO = "/api/system/getWorkspaceInfo";

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

/** 绝对路径统一成正斜杠、去掉尾部分隔符，好做前缀比较。 */
const normalizeRoot = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

let cachedRoot: string | undefined;

/**
 * 工作区绝对路径。
 *
 * 浏览器前端（Docker、网页版）拿不到它：内核在 `/api/system/getConf` 里会把
 * workspaceDir 连同其它绝对路径一起抹掉，免得把用户名之类的目录信息泄露给浏览器。
 * 那种情况下改问 `/api/system/getWorkspaceInfo`——它只对管理员开放，与定位、
 * 写回资源所需的权限是同一档，拿不到就意味着后面几步本来也做不了。
 */
async function workspaceDir(): Promise<string | undefined> {
    if (cachedRoot) {
        return cachedRoot;
    }
    const fromConfig = config().system?.workspaceDir;
    if (fromConfig) {
        cachedRoot = normalizeRoot(fromConfig);
        return cachedRoot;
    }
    try {
        const info = await postJson<{workspaceDir?: string}>(WORKSPACE_INFO, {});
        if (info.code !== 0 || !info.data?.workspaceDir) {
            return undefined;
        }
        cachedRoot = normalizeRoot(info.data.workspaceDir);
        return cachedRoot;
    } catch {
        // 旧内核没有这个接口、或当前不是管理员：退回「无法定位」，与之前的表现一致
        return undefined;
    }
}

/** 绝对路径 → 工作区相对路径；不在 workspace/data 之下时返回 undefined。 */
function toApiPath(absolute: string, root: string): string | undefined {
    if (!absolute) {
        return undefined;
    }
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
        const root = await workspaceDir();
        const apiPath = root ? toApiPath(resolved.data, root) : undefined;
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

/** 工作区相对路径 → 工作区内的绝对路径（正斜杠）；拿不到工作区位置时返回 undefined。 */
export async function absolutePath(apiPath: string): Promise<string | undefined> {
    const root = await workspaceDir();
    return root ? `${root}${apiPath}` : undefined;
}

/**
 * 定位工作区里的普通文本文件，目前只有 .sy 文档预览走这条路径。
 *
 * 与 assets 链接不同，调用方给过来的已经是工作区相对路径（`/data/<笔记本ID>/<路径>.sy`），
 * 不需要 resolveAssetPath 再解析一次。体积仍然要事先问过内核：读接口是整体读入内存的，
 * 超限的文件一旦开始读就拦不住。statAsset 只认 assets 链接与本地绝对路径，所以这里
 * 把相对路径拼回 `file://` URL——内核会校验它确实落在工作区内。
 */
export async function resolveWorkspaceFile(apiPath: string): Promise<TResolveResult> {
    const root = await workspaceDir();
    if (!apiPath.startsWith("/data/") || !root) {
        return {kind: "error", message: "not a workspace file"};
    }
    const absolute = `${root}${apiPath}`;
    try {
        const stat = await postJson<{size: number}>(STAT_ASSET, {path: `file://${absolute}`});
        if (stat.code !== 0) {
            return {kind: "error", message: stat.msg || `code ${stat.code}`};
        }
        return {kind: "ok", ref: {link: apiPath, apiPath, size: stat.data.size}};
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
