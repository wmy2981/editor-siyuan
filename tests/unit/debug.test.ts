import {afterEach, describe, expect, it, vi} from "vitest";
import {debug, setDebug} from "../../src/core/debug";

afterEach(() => {
    setDebug(false);
});

describe("debug", () => {
    it("默认关闭，不写控制台", () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        debug("hidden");
        expect(log).not.toHaveBeenCalled();
    });

    it("打开后带统一前缀输出", () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        setDebug(true);
        debug("loaded", {count: 1});
        expect(log).toHaveBeenCalledWith("[editor-siyuan]", "loaded", {count: 1});
    });

    it("关闭后立刻停止输出", () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        setDebug(true);
        debug("first");
        setDebug(false);
        debug("second");
        expect(log).toHaveBeenCalledTimes(1);
    });
});
