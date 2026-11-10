import {beforeEach, describe, expect, it, vi} from "vitest";
import {binaryResponse, installConfig, jsonResponse, stubFetch, utf8} from "../support/env";
import type {IAssetRef} from "../../src/files/asset";

const RESOLVE = "/api/asset/resolveAssetPath";
const STAT = "/api/asset/statAsset";
const PUT_FILE = "/api/file/putFile";
const WORKSPACE_INFO = "/api/system/getWorkspaceInfo";

/** asset.ts 缓存了工作区绝对路径，每个测试重新求值模块，避免测试之间互相污染。 */
let asset: typeof import("../../src/files/asset");

beforeEach(async () => {
    vi.resetModules();
    asset = await import("../../src/files/asset");
});

function resolveFetch(options: {data?: string; size?: number; statCode?: number; statMsg?: string} = {}) {
    return stubFetch((url) => {
        if (url === RESOLVE) {
            return jsonResponse({code: 0, msg: "", data: options.data ?? "E:/SiYuan/data/assets/a.txt"});
        }
        if (url === STAT) {
            return jsonResponse({
                code: options.statCode ?? 0,
                msg: options.statMsg ?? "",
                data: {size: options.size ?? 12},
            });
        }
        if (url === WORKSPACE_INFO) {
            return jsonResponse({code: 0, msg: "", data: {workspaceDir: "E:/SiYuan"}});
        }
        return jsonResponse({code: 1, msg: "unexpected request"});
    });
}

function readBlob(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("resolveAsset", () => {
    it("只接受 assets/ 前缀的链接，不发起请求", async () => {
        const fetch = stubFetch(() => jsonResponse({}));
        for (const link of ["", "/data/a.txt", "assetsx/a.txt", "file:///tmp/a.txt"]) {
            await expect(asset.resolveAsset(link)).resolves.toEqual({
                kind: "error",
                message: "not an asset link",
            });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it("解析出规范化链接、工作区相对路径与体积", async () => {
        const fetch = resolveFetch();
        const result = await asset.resolveAsset("assets/a.txt?box=20210808180117");
        expect(result).toEqual({
            kind: "ok",
            ref: {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 12},
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
            path: "assets/a.txt?box=20210808180117",
        });
        expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({
            path: "assets/a.txt?box=20210808180117",
        });
    });

    it("把 Windows 反斜杠绝对路径转成正斜杠", async () => {
        installConfig({system: {workspaceDir: "E:\\SiYuan\\"}});
        resolveFetch({data: "E:\\SiYuan\\data\\assets\\a.txt"});
        const result = await asset.resolveAsset("assets/a.txt");
        expect(result).toEqual({
            kind: "ok",
            ref: {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 12},
        });
    });

    it("定位失败时返回内核给的 message", async () => {
        stubFetch(() => jsonResponse({code: 1, msg: "asset not found", data: ""}));
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "asset not found",
        });
    });

    it("定位失败且没有 message 时给出 code", async () => {
        stubFetch(() => jsonResponse({code: 7, msg: "", data: ""}));
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "code 7",
        });
    });

    it("stat 失败时返回错误", async () => {
        resolveFetch({statCode: 1, statMsg: "stat failed"});
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "stat failed",
        });
    });

    it("解析结果不在工作区 data 下时拒绝", async () => {
        resolveFetch({data: "C:/Other/data/assets/a.txt"});
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "encrypted or outside workspace",
        });
    });

    it("解析结果为空时拒绝", async () => {
        resolveFetch({data: ""});
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "encrypted or outside workspace",
        });
    });

    it("HTTP 失败时把状态码带进错误", async () => {
        stubFetch(() => jsonResponse({}, 500));
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: `${RESOLVE} HTTP 500`,
        });
    });

    it("配置里没有工作区路径时改问 getWorkspaceInfo", async () => {
        installConfig({system: {workspaceDir: ""}});
        const fetch = resolveFetch();
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "ok",
            ref: {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 12},
        });
        expect(fetch.mock.calls.map(([url]) => url)).toEqual([RESOLVE, WORKSPACE_INFO, STAT]);
    });

    it("工作区路径只问一次并缓存", async () => {
        installConfig({system: {workspaceDir: ""}});
        const fetch = resolveFetch();
        await asset.resolveAsset("assets/a.txt");
        await asset.resolveAsset("assets/b.txt");
        expect(fetch.mock.calls.filter(([url]) => url === WORKSPACE_INFO)).toHaveLength(1);
    });

    it("getWorkspaceInfo 返回失败时按无法定位处理", async () => {
        installConfig({system: {workspaceDir: ""}});
        stubFetch((url) => {
            if (url === RESOLVE) {
                return jsonResponse({code: 0, msg: "", data: "E:/SiYuan/data/assets/a.txt"});
            }
            return jsonResponse({code: 1, msg: "denied", data: null});
        });
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "encrypted or outside workspace",
        });
    });

    it("getWorkspaceInfo 抛错时按无法定位处理", async () => {
        installConfig({system: {workspaceDir: ""}});
        stubFetch((url) => {
            if (url === RESOLVE) {
                return jsonResponse({code: 0, msg: "", data: "E:/SiYuan/data/assets/a.txt"});
            }
            throw new Error("network down");
        });
        await expect(asset.resolveAsset("assets/a.txt")).resolves.toEqual({
            kind: "error",
            message: "encrypted or outside workspace",
        });
    });
});

describe("resolveWorkspaceFile", () => {
    it("只接受 /data/ 下的路径", async () => {
        const fetch = stubFetch(() => jsonResponse({}));
        for (const path of ["", "assets/a.sy", "E:/SiYuan/data/a.sy", "/tmp/a.sy"]) {
            await expect(asset.resolveWorkspaceFile(path)).resolves.toEqual({
                kind: "error",
                message: "not a workspace file",
            });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it("定位成功时用 file:// 绝对路径问 stat", async () => {
        const fetch = resolveFetch({size: 99});
        const result = await asset.resolveWorkspaceFile("/data/box/doc.sy");
        expect(result).toEqual({
            kind: "ok",
            ref: {link: "/data/box/doc.sy", apiPath: "/data/box/doc.sy", size: 99},
        });
        expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
            path: "file://E:/SiYuan/data/box/doc.sy",
        });
    });

    it("拿不到工作区路径时拒绝", async () => {
        installConfig({system: {workspaceDir: ""}});
        stubFetch(() => jsonResponse({code: 1, msg: "denied", data: null}));
        await expect(asset.resolveWorkspaceFile("/data/box/doc.sy")).resolves.toEqual({
            kind: "error",
            message: "not a workspace file",
        });
    });

    it("stat 失败时返回内核错误", async () => {
        resolveFetch({statCode: 1, statMsg: "missing"});
        await expect(asset.resolveWorkspaceFile("/data/box/doc.sy")).resolves.toEqual({
            kind: "error",
            message: "missing",
        });
    });

    it("HTTP 失败时把状态码带进错误", async () => {
        stubFetch(() => jsonResponse({}, 502));
        await expect(asset.resolveWorkspaceFile("/data/box/doc.sy")).resolves.toEqual({
            kind: "error",
            message: `${STAT} HTTP 502`,
        });
    });
});

describe("readAssetText", () => {
    const ref: IAssetRef = {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 10};

    it("按 UTF-8 解码，换行统一为 \\n", async () => {
        const fetch = stubFetch(() => binaryResponse(utf8("hello\nworld")));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "hello\nworld",
            eol: "\n",
            bom: false,
        });
        expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({path: "/data/assets/a.txt"});
    });

    it("保留 CRLF 风格并记录 eol", async () => {
        stubFetch(() => binaryResponse(utf8("a\r\nb\r\n")));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "a\nb\n",
            eol: "\r\n",
            bom: false,
        });
    });

    it("孤立 \\r 也规整为 \\n，但不把文件标成 CRLF", async () => {
        stubFetch(() => binaryResponse(utf8("a\rb")));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "a\nb",
            eol: "\n",
            bom: false,
        });
    });

    it("识别并去掉 UTF-8 BOM", async () => {
        const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8("abc")]);
        stubFetch(() => binaryResponse(bytes));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "abc",
            eol: "\n",
            bom: true,
        });
    });

    it("BOM 与 CRLF 同时存在", async () => {
        const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8("a\r\nb")]);
        stubFetch(() => binaryResponse(bytes));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "a\nb",
            eol: "\r\n",
            bom: true,
        });
    });

    it("只有两字节的 BOM 前缀不算 BOM", async () => {
        stubFetch(() => binaryResponse(new Uint8Array([0xEF, 0xBB])));
        await expect(asset.readAssetText(ref)).resolves.toEqual({
            text: "\uFFFD",
            eol: "\n",
            bom: false,
        });
    });

    it("失败响应走 JSON 信封，取 msg", async () => {
        stubFetch(() => ({
            ok: false,
            status: 202,
            json: async () => ({code: 1, msg: "file not found", data: null}),
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response);
        await expect(asset.readAssetText(ref)).rejects.toThrow("file not found");
    });

    it("失败响应不是 JSON 时保留 HTTP 状态", async () => {
        stubFetch(() => ({
            ok: false,
            status: 202,
            json: async () => {
                throw new Error("not json");
            },
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response);
        await expect(asset.readAssetText(ref)).rejects.toThrow("HTTP 202");
    });

    it("非 200 状态一律按失败处理", async () => {
        stubFetch(() => ({
            ok: true,
            status: 201,
            json: async () => ({code: 0, msg: "", data: null}),
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response);
        await expect(asset.readAssetText(ref)).rejects.toThrow("HTTP 201");
    });
});

describe("writeAssetText", () => {
    const ref: IAssetRef = {link: "assets/a.txt", apiPath: "/data/assets/a.txt", size: 10};

    async function captureBody(response: Response = jsonResponse({code: 0, msg: "", data: null})) {
        const fetch = stubFetch(() => response);
        const error = await asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: false});
        const body = fetch.mock.calls[0][1].body as FormData;
        const file = body.get("file") as File;
        return {error, body, file, bytes: await readBlob(file), fetch};
    }

    it("写回成功时返回 undefined，并带上路径与文件名", async () => {
        const {error, body, file, bytes} = await captureBody();
        expect(error).toBeUndefined();
        expect(body.get("path")).toBe("/data/assets/a.txt");
        expect(body.get("isDir")).toBe("false");
        expect(file.name).toBe("a.txt");
        expect(decode(bytes)).toBe("abc");
    });

    it("CRLF 文件写回时把 \\n 还原成 \\r\\n", async () => {
        const fetch = stubFetch(() => jsonResponse({code: 0, msg: "", data: null}));
        await asset.writeAssetText(ref, {text: "a\nb\n", eol: "\r\n", bom: false});
        const body = fetch.mock.calls[0][1].body as FormData;
        const bytes = await readBlob(body.get("file") as File);
        expect(decode(bytes)).toBe("a\r\nb\r\n");
    });

    it("原来有 BOM 时写回也带 BOM", async () => {
        const fetch = stubFetch(() => jsonResponse({code: 0, msg: "", data: null}));
        await asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: true});
        const body = fetch.mock.calls[0][1].body as FormData;
        const bytes = await readBlob(body.get("file") as File);
        expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
        expect(decode(bytes.subarray(3))).toBe("abc");
    });

    it("原来没有 BOM 时不加 BOM", async () => {
        const {bytes} = await captureBody();
        expect(bytes[0]).not.toBe(0xEF);
    });

    it("内核返回错误时返回可展示的 message", async () => {
        stubFetch(() => jsonResponse({code: 1, msg: "permission denied", data: null}));
        await expect(asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: false}))
            .resolves.toBe("permission denied");
    });

    it("错误信封没有 message 时给出 code", async () => {
        stubFetch(() => jsonResponse({code: 3, msg: "", data: null}));
        await expect(asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: false}))
            .resolves.toBe("code 3");
    });

    it("网络异常时返回异常信息", async () => {
        stubFetch(() => {
            throw new Error("network down");
        });
        await expect(asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: false}))
            .resolves.toBe("network down");
    });

    it("响应不是 JSON 时返回解析错误", async () => {
        stubFetch(() => ({
            ok: true,
            status: 200,
            json: async () => {
                throw new Error("bad json");
            },
        }) as unknown as Response);
        await expect(asset.writeAssetText(ref, {text: "abc", eol: "\n", bom: false}))
            .resolves.toBe("bad json");
    });

    it("请求发到 putFile", async () => {
        const {fetch} = await captureBody();
        expect(fetch.mock.calls[0][0]).toBe(PUT_FILE);
    });
});
