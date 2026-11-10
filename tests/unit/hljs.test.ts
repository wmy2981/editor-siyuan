import {beforeEach, describe, expect, it, vi} from "vitest";
import {installHljs, uninstallHljs} from "../support/env";

const CDN = "/stage/protyle/js/highlight.js";
const SCRIPT_ID = "editor-siyuan-hljsScript";
const THIRD_ID = "editor-siyuan-hljsThirdScript";

let loadHljs: typeof import("../../src/editor/hljs").loadHljs;
let setDebug: typeof import("../../src/core/debug").setDebug;

beforeEach(async () => {
    vi.resetModules();
    ({loadHljs} = await import("../../src/editor/hljs"));
    ({setDebug} = await import("../../src/core/debug"));
});

const scripts = (): HTMLScriptElement[] =>
    Array.from(document.head.querySelectorAll("script"));

async function waitForScripts(count: number): Promise<void> {
    await vi.waitFor(() => expect(scripts()).toHaveLength(count));
}

describe("loadHljs", () => {
    it("引擎已存在时直接返回 true，不注入脚本", async () => {
        installHljs();
        await expect(loadHljs()).resolves.toBe(true);
        expect(scripts()).toHaveLength(0);
    });

    it("先加载 highlight.min.js，再加载 third-languages.js", async () => {
        const pending = loadHljs();
        const first = scripts()[0];
        expect(first.src).toContain(`${CDN}/highlight.min.js?v=11.12.0`);
        expect(first.async).toBe(true);
        expect(first.id).toBe("");

        installHljs();
        first.dispatchEvent(new Event("load"));
        expect(first.id).toBe(SCRIPT_ID);
        await waitForScripts(2);

        const second = scripts()[1];
        expect(second.src).toContain(`${CDN}/third-languages.js?v=2.0.1`);
        expect(second.async).toBe(true);

        second.dispatchEvent(new Event("load"));
        expect(second.id).toBe(THIRD_ID);
        await expect(pending).resolves.toBe(true);
    });

    it("第一个脚本加载失败时移除它并返回 false", async () => {
        const pending = loadHljs();
        const first = scripts()[0];
        first.dispatchEvent(new Event("error"));
        await expect(pending).resolves.toBe(false);
        expect(first.isConnected).toBe(false);
    });

    it("第二个脚本加载失败时返回 false", async () => {
        const pending = loadHljs();
        installHljs();
        scripts()[0].dispatchEvent(new Event("load"));
        await waitForScripts(2);
        const second = scripts()[1];
        second.dispatchEvent(new Event("error"));
        await expect(pending).resolves.toBe(false);
        expect(second.isConnected).toBe(false);
    });

    it("脚本都加载完但 window.hljs 仍不存在时返回 false", async () => {
        const pending = loadHljs();
        scripts()[0].dispatchEvent(new Event("load"));
        await waitForScripts(2);
        scripts()[1].dispatchEvent(new Event("load"));
        await expect(pending).resolves.toBe(false);
    });

    it("失败后清空 pending，下次调用会重新注入", async () => {
        const pending = loadHljs();
        scripts()[0].dispatchEvent(new Event("error"));
        await expect(pending).resolves.toBe(false);
        expect(scripts()).toHaveLength(0);

        const retry = loadHljs();
        expect(scripts()).toHaveLength(1);
        scripts()[0].dispatchEvent(new Event("error"));
        await expect(retry).resolves.toBe(false);
    });

    it("并发调用共用同一个 Promise 与同一批脚本", async () => {
        const first = loadHljs();
        const second = loadHljs();
        expect(second).toBe(first);
        expect(scripts()).toHaveLength(1);
        scripts()[0].dispatchEvent(new Event("error"));
        await expect(first).resolves.toBe(false);
    });

    it("成功时输出调试日志", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        setDebug(true);
        const pending = loadHljs();
        installHljs({languages: ["plaintext", "javascript", "css"]});
        scripts()[0].dispatchEvent(new Event("load"));
        await waitForScripts(2);
        scripts()[1].dispatchEvent(new Event("load"));
        await expect(pending).resolves.toBe(true);
        expect(log).toHaveBeenCalledWith("[editor-siyuan]", "hljs ready", {languages: 3});
        setDebug(false);
    });

    it("失败时输出调试日志", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        setDebug(true);
        const pending = loadHljs();
        scripts()[0].dispatchEvent(new Event("error"));
        await expect(pending).resolves.toBe(false);
        expect(log).toHaveBeenCalledWith("[editor-siyuan]", "hljs load failed");
        setDebug(false);
    });

    it("引擎已存在时不会清空已有脚本", async () => {
        uninstallHljs();
        installHljs();
        await loadHljs();
        expect(scripts()).toHaveLength(0);
    });
});
