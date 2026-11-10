import {describe, expect, it} from "vitest";
import {installHljs} from "../support/env";
import {
    availableLanguages,
    guessLanguage,
    normalizeLanguage,
    PLAIN_TEXT,
} from "../../src/files/language";

describe("guessLanguage", () => {
    it("把扩展名映射成 hljs 语言标识", () => {
        const cases: Array<[string, string]> = [
            ["assets/a.txt", PLAIN_TEXT],
            ["assets/a.md", "markdown"],
            ["assets/a.markdown", "markdown"],
            ["assets/a.adoc", "asciidoc"],
            ["assets/a.json", "json"],
            ["assets/a.jsonc", "json"],
            ["assets/a.json5", "json"],
            ["assets/a.sy", "json"],
            ["assets/a.yaml", "yaml"],
            ["assets/a.yml", "yaml"],
            ["assets/a.toml", "ini"],
            ["assets/a.properties", "properties"],
            ["assets/a.html", "html"],
            ["assets/a.htm", "html"],
            ["assets/a.vue", "xml"],
            ["assets/a.css", "css"],
            ["assets/a.scss", "scss"],
            ["assets/a.less", "less"],
            ["assets/a.js", "javascript"],
            ["assets/a.mjs", "javascript"],
            ["assets/a.cjs", "javascript"],
            ["assets/a.jsx", "javascript"],
            ["assets/a.ts", "typescript"],
            ["assets/a.tsx", "typescript"],
            ["assets/a.mts", "typescript"],
            ["assets/a.py", "python"],
            ["assets/a.rb", "ruby"],
            ["assets/a.go", "go"],
            ["assets/a.rs", "rust"],
            ["assets/a.kt", "kotlin"],
            ["assets/a.cpp", "cpp"],
            ["assets/a.cs", "csharp"],
            ["assets/a.m", "objectivec"],
            ["assets/a.sh", "bash"],
            ["assets/a.ps1", "powershell"],
            ["assets/a.bat", "dos"],
            ["assets/a.gradle", "groovy"],
            ["assets/a.proto", "protobuf"],
            ["assets/a.graphql", "graphql"],
            ["assets/a.diff", "diff"],
            ["assets/a.tex", "latex"],
        ];
        for (const [path, language] of cases) {
            expect(guessLanguage(path), path).toBe(language);
        }
    });

    it("大小写不敏感", () => {
        expect(guessLanguage("assets/A.PY")).toBe("python");
        expect(guessLanguage("assets/A.MD")).toBe("markdown");
    });

    it("忽略查询串与片段", () => {
        expect(guessLanguage("assets/a.ts?box=x")).toBe("typescript");
        expect(guessLanguage("assets/a.ts#L1")).toBe("typescript");
    });

    it("不认识的扩展名与无扩展名都给纯文本", () => {
        expect(guessLanguage("assets/a.unknown")).toBe(PLAIN_TEXT);
        expect(guessLanguage("assets/Makefile")).toBe(PLAIN_TEXT);
        expect(guessLanguage("")).toBe(PLAIN_TEXT);
    });

    it("点开头的文件按纯文本处理", () => {
        expect(guessLanguage("assets/.gitignore")).toBe(PLAIN_TEXT);
    });
});

describe("availableLanguages", () => {
    it("引擎未加载时只有纯文本", () => {
        expect(availableLanguages()).toEqual([PLAIN_TEXT]);
    });

    it("纯文本排在最前，其余按字母序", () => {
        installHljs({languages: ["xml", "javascript", "plaintext", "bash", "css"]});
        expect(availableLanguages()).toEqual([PLAIN_TEXT, "bash", "css", "javascript", "xml"]);
    });

    it("引擎没把纯文本列出来时也只补一次", () => {
        installHljs({languages: ["javascript", "css"]});
        expect(availableLanguages()).toEqual([PLAIN_TEXT, "css", "javascript"]);
    });

    it("不修改引擎返回的数组", () => {
        const languages = ["xml", "bash"];
        const {calls} = installHljs({languages});
        availableLanguages();
        expect(languages).toEqual(["xml", "bash"]);
        expect(calls).toHaveLength(0);
    });

    it("把别名也列出来，带点的别名除外", () => {
        installHljs({
            languages: ["xml", "javascript", "bash"],
            aliases: {
                xml: ["html", "svg", "html.hbs"],
                javascript: ["js", "mjs"],
                bash: ["zsh"],
            },
        });
        expect(availableLanguages()).toEqual([
            PLAIN_TEXT, "bash", "html", "javascript", "js", "mjs", "svg", "xml", "zsh",
        ]);
    });
});

describe("normalizeLanguage", () => {
    it("引擎未加载时一律退回纯文本", () => {
        expect(normalizeLanguage("javascript")).toBe(PLAIN_TEXT);
        expect(normalizeLanguage(PLAIN_TEXT)).toBe(PLAIN_TEXT);
    });

    it("引擎认识的语言原样返回", () => {
        installHljs({languages: ["javascript", "plaintext"]});
        expect(normalizeLanguage("javascript")).toBe("javascript");
        expect(normalizeLanguage(PLAIN_TEXT)).toBe(PLAIN_TEXT);
    });

    it("引擎不认识的语言退回纯文本", () => {
        installHljs({languages: ["javascript"]});
        expect(normalizeLanguage("brainfuck")).toBe(PLAIN_TEXT);
    });

    it("引擎认识的别名原样返回", () => {
        installHljs({languages: ["xml"], aliases: {xml: ["html"]}});
        expect(normalizeLanguage("html")).toBe("html");
    });
});
