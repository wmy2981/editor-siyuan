import {describe, expect, it} from "vitest";
import {baseName, config, escapeHtml, stripQuery} from "../../src/core/util";

describe("escapeHtml", () => {
    it("转义全部五个 HTML 敏感字符", () => {
        expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    it("保留普通字符与已有的实体写法", () => {
        expect(escapeHtml("a & b")).toBe("a &amp; b");
        expect(escapeHtml("&amp;")).toBe("&amp;amp;");
        expect(escapeHtml("中文、空格 与 emoji 😀")).toBe("中文、空格 与 emoji 😀");
    });

    it("一次替换所有出现位置", () => {
        expect(escapeHtml("<a href=\"x\">'&'</a>"))
            .toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    });

    it("空串原样返回", () => {
        expect(escapeHtml("")).toBe("");
    });
});

describe("baseName", () => {
    it("取最后一个斜杠之后的部分", () => {
        expect(baseName("assets/notes/a.txt")).toBe("a.txt");
        expect(baseName("assets/a.txt")).toBe("a.txt");
    });

    it("没有斜杠时返回整个路径", () => {
        expect(baseName("a.txt")).toBe("a.txt");
        expect(baseName("")).toBe("");
    });

    it("以斜杠结尾时返回空串", () => {
        expect(baseName("assets/notes/")).toBe("");
    });

    it("只按 / 切分，反斜杠是文件名的一部分", () => {
        expect(baseName("assets\\a.txt")).toBe("assets\\a.txt");
    });
});

describe("stripQuery", () => {
    it("去掉查询串", () => {
        expect(stripQuery("assets/a.txt?box=20210808180117")).toBe("assets/a.txt");
    });

    it("去掉片段", () => {
        expect(stripQuery("assets/a.txt#L10")).toBe("assets/a.txt");
    });

    it("同时去掉查询串与片段", () => {
        expect(stripQuery("assets/a.txt?box=x#L1")).toBe("assets/a.txt");
    });

    it("没有查询串与片段时原样返回", () => {
        expect(stripQuery("assets/a.txt")).toBe("assets/a.txt");
    });

    it("只切第一个 ? 或 #", () => {
        expect(stripQuery("a?b?c")).toBe("a");
        expect(stripQuery("a#b#c")).toBe("a");
        expect(stripQuery("a#b?c")).toBe("a");
        expect(stripQuery("a?b#c")).toBe("a");
    });
});

describe("config", () => {
    it("返回 window.siyuan.config", () => {
        expect(config()).toBe((window as any).siyuan.config);
    });

    it("宿主没有 config 时抛错，而不是静默返回 undefined", () => {
        delete (window as any).siyuan;
        expect(() => config()).toThrow();
    });
});
