import {describe, expect, it} from "vitest";
import {canFormat, canMinify, formatText, minifyText} from "../../src/format/format";

describe("canFormat", () => {
    it("有 prettier parser 的语言与扩展名组合为真", () => {
        const cases: Array<[string, string]> = [
            ["javascript", "assets/a.js"],
            ["typescript", "assets/a.ts"],
            ["typescript", "assets/a.tsx"],
            ["json", "assets/a.json"],
            ["json", "assets/a.json5"],
            ["css", "assets/a.css"],
            ["scss", "assets/a.scss"],
            ["less", "assets/a.less"],
            ["xml", "assets/a.html"],
            ["html", "assets/a.html"],
            ["xml", "assets/a.vue"],
            ["yaml", "assets/a.yaml"],
            ["markdown", "assets/a.md"],
        ];
        for (const [language, link] of cases) {
            expect(canFormat(language, link), `${language} ${link}`).toBe(true);
        }
    });

    it("svelte 没有解析器，置灰", () => {
        expect(canFormat("xml", "assets/a.svelte")).toBe(false);
    });

    it("不认识的语言为假", () => {
        expect(canFormat("python", "assets/a.py")).toBe(false);
        expect(canFormat("plaintext", "assets/a.txt")).toBe(false);
    });

    it("扩展名大小写与查询串不影响判断", () => {
        expect(canFormat("javascript", "assets/A.JS?box=x")).toBe(true);
    });
});

describe("canMinify", () => {
    it("只有 JSON、JavaScript 与 CSS 有压缩实现", () => {
        expect(canMinify("json", "assets/a.json")).toBe(true);
        expect(canMinify("json", "assets/a.jsonc")).toBe(true);
        expect(canMinify("javascript", "assets/a.js")).toBe(true);
        expect(canMinify("css", "assets/a.css")).toBe(true);
    });

    it("json5 与 jsx 不支持压缩", () => {
        expect(canMinify("json", "assets/a.json5")).toBe(false);
        expect(canMinify("javascript", "assets/a.jsx")).toBe(false);
    });

    it("其余语言为假", () => {
        expect(canMinify("typescript", "assets/a.ts")).toBe(false);
        expect(canMinify("scss", "assets/a.scss")).toBe(false);
        expect(canMinify("xml", "assets/a.html")).toBe(false);
        expect(canMinify("plaintext", "assets/a.txt")).toBe(false);
    });
});

describe("formatText", () => {
    it("没有选项时用 prettier 自己的默认缩进", async () => {
        expect(await formatText("javascript", "assets/a.js", "function f(){return 1}"))
            .toBe("function f() {\n  return 1;\n}\n");
    });

    it("选项里的 tabWidth 与 useTabs 生效", async () => {
        expect(await formatText("javascript", "assets/a.js", "function f(){return 1}", {tabWidth: 8, useTabs: false}))
            .toBe("function f() {\n        return 1;\n}\n");
        expect(await formatText("javascript", "assets/a.js", "function f(){return 1}", {useTabs: true}))
            .toBe("function f() {\n\treturn 1;\n}\n");
    });

    it("格式化 JavaScript", async () => {
        expect(await formatText("javascript", "assets/a.js", "const a={b:1}"))
            .toBe("const a = { b: 1 };\n");
    });

    it("格式化 JSON 与 JSON5", async () => {
        expect(await formatText("json", "assets/a.json", "{\"a\":1}")).toBe("{ \"a\": 1 }\n");
        expect(await formatText("json", "assets/a.json5", "{a:1}")).toBe("{ a: 1 }\n");
    });

    it("按 .tsx 扩展名选择 TSX 语法", async () => {
        expect(await formatText("typescript", "assets/a.tsx", "const x=<div/>"))
            .toBe("const x = <div />;\n");
    });

    it(".ts 不按 JSX 解析", async () => {
        await expect(formatText("typescript", "assets/a.ts", "const x=<div/>")).rejects.toThrow();
    });

    it("格式化 CSS、SCSS 与 LESS", async () => {
        expect(await formatText("css", "assets/a.css", "a{color:red}")).toBe("a {\n  color: red;\n}\n");
        expect(await formatText("scss", "assets/a.scss", "$c:red;a{color:$c}"))
            .toBe("$c: red;\na {\n  color: $c;\n}\n");
        expect(await formatText("less", "assets/a.less", "@c:red;a{color:@c}"))
            .toBe("@c: red;\na {\n  color: @c;\n}\n");
    });

    it("格式化 HTML 与 Vue", async () => {
        expect(await formatText("xml", "assets/a.html", "<div><span>x</span></div>"))
            .toBe("<div><span>x</span></div>\n");
        // .html 现在报的是 xml 的别名 html，解析器不能因此断掉
        expect(await formatText("html", "assets/a.html", "<div><span>x</span></div>"))
            .toBe("<div><span>x</span></div>\n");
        expect(await formatText("xml", "assets/a.vue", "<template><div/></template>"))
            .toBe("<template><div /></template>\n");
    });

    it("格式化 YAML 与 Markdown", async () => {
        expect(await formatText("yaml", "assets/a.yaml", "a:   1")).toBe("a: 1\n");
        expect(await formatText("markdown", "assets/a.md", "#  title")).toBe("# title\n");
    });

    it("没有实现的语言抛错", async () => {
        await expect(formatText("python", "assets/a.py", "x=1")).rejects.toThrow("no formatter for python");
    });

    it("语法错误时把 prettier 的原文抛给调用方", async () => {
        await expect(formatText("javascript", "assets/a.js", "const =")).rejects.toThrow();
    });
});

describe("minifyText", () => {
    it("压缩 JSON，并去掉注释与尾随逗号", async () => {
        const source = `{
            // 注释
            "a": 1,
            /* 块注释 */
            "b": [1, 2,],
        }`;
        expect(await minifyText("json", "assets/a.json", source)).toBe("{\"a\":1,\"b\":[1,2]}");
    });

    it("JSONC 的注释同样剥掉", async () => {
        expect(await minifyText("json", "assets/a.jsonc", "{ // x\n \"a\": 1 }")).toBe("{\"a\":1}");
    });

    it("字符串里的 // 与 /* 不被当成注释", async () => {
        const source = "{\"url\":\"http://x//y\",\"glob\":\"a/*b*/c\"}";
        expect(await minifyText("json", "assets/a.json", source))
            .toBe("{\"url\":\"http://x//y\",\"glob\":\"a/*b*/c\"}");
    });

    it("字符串里的转义引号不影响注释识别", async () => {
        const source = "{\"quote\":\"a\\\"//b\",\"x\":1}";
        expect(await minifyText("json", "assets/a.json", source))
            .toBe("{\"quote\":\"a\\\"//b\",\"x\":1}");
    });

    it("字符串里的尾随逗号字样不会被删", async () => {
        expect(await minifyText("json", "assets/a.json", "{\"a\":\",\"}")).toBe("{\"a\":\",\"}");
    });

    it("压缩 JavaScript", async () => {
        const result = await minifyText("javascript", "assets/a.js", "function add(a, b) {\n    return a + b;\n}");
        expect(result).not.toContain("\n");
        expect(result).toContain("function add");
    });

    it("压缩 CSS 但不合并规则", async () => {
        const result = await minifyText("css", "assets/a.css", "a { color: red; }\nb { color: red; }");
        expect(result).toBe("a{color:red}b{color:red}");
    });

    it("没有实现的语言抛错", async () => {
        await expect(minifyText("scss", "assets/a.scss", "a{color:red}")).rejects.toThrow("no minifier for scss");
        await expect(minifyText("json", "assets/a.json5", "{a:1}")).rejects.toThrow("no minifier for json");
        await expect(minifyText("javascript", "assets/a.jsx", "const a = <div/>")).rejects.toThrow("no minifier for javascript");
    });

    it("JSON 语法错误时抛错", async () => {
        await expect(minifyText("json", "assets/a.json", "{a:1}")).rejects.toThrow();
    });

    it("JavaScript 语法错误时抛错", async () => {
        await expect(minifyText("javascript", "assets/a.js", "function (")).rejects.toThrow();
    });
});

describe("formatText 的自定义配置", () => {
    it("配置改不动 parser：按语言选的解析器仍然生效", async () => {
        // parser 若真被改成 json，这段 JavaScript 会解析失败
        expect(await formatText("javascript", "assets/a.js", "const a=1", {parser: "json"}))
            .toBe("const a = 1;\n");
    });

    it("配置改不动 plugins：没有插件就解析不了", async () => {
        expect(await formatText("javascript", "assets/a.js", "const a=1", {plugins: []}))
            .toBe("const a = 1;\n");
    });
});
