import {describe, expect, it} from "vitest";
import {__setFrontend} from "../support/siyuan";
import {frontend, isBrowserFrontend, isMobileFrontend, isSeparateWindow} from "../../src/core/frontend";

describe("frontend", () => {
    it("把宿主的前端标识原样返回", () => {
        __setFrontend("desktop-window");
        expect(frontend()).toBe("desktop-window");
    });
});

describe("isBrowserFrontend", () => {
    it("browser-desktop 与 browser-mobile 为真", () => {
        __setFrontend("browser-desktop");
        expect(isBrowserFrontend()).toBe(true);
        __setFrontend("browser-mobile");
        expect(isBrowserFrontend()).toBe(true);
    });

    it("桌面端与手机 App 为假", () => {
        for (const value of ["desktop", "desktop-window", "mobile"]) {
            __setFrontend(value);
            expect(isBrowserFrontend(), value).toBe(false);
        }
    });
});

describe("isMobileFrontend", () => {
    it("mobile 与 browser-mobile 为真", () => {
        __setFrontend("mobile");
        expect(isMobileFrontend()).toBe(true);
        __setFrontend("browser-mobile");
        expect(isMobileFrontend()).toBe(true);
    });

    it("桌面端与桌面浏览器为假", () => {
        for (const value of ["desktop", "desktop-window", "browser-desktop"]) {
            __setFrontend(value);
            expect(isMobileFrontend(), value).toBe(false);
        }
    });
});

describe("isSeparateWindow", () => {
    it("只有 desktop-window 为真", () => {
        for (const value of ["desktop", "mobile", "browser-desktop", "browser-mobile"]) {
            __setFrontend(value);
            expect(isSeparateWindow(), value).toBe(false);
        }
        __setFrontend("desktop-window");
        expect(isSeparateWindow()).toBe(true);
    });
});
