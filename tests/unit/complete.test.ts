import {describe, expect, it} from "vitest";
import {keywordList} from "../../src/complete";

describe("keywordList", () => {
    it("空格分隔的字符串", () => {
        expect(keywordList("if else  return\nlet")).toEqual(["if", "else", "return", "let"]);
    });

    it("数组形态，可以嵌套", () => {
        expect(keywordList(["if", ["else", "for"]])).toEqual(["if", "else", "for"]);
    });

    it("按类别分组的对象形态，跳过 $pattern", () => {
        expect(keywordList({
            keyword: "if else",
            built_in: ["print", "console"],
            literal: "true false",
            $pattern: /[a-zA-Z]+/,
        })).toEqual(["if", "else", "print", "console", "true", "false"]);
    });

    it("非法形态返回空列表", () => {
        for (const value of [undefined, null, 1, true, {}, /re/]) {
            expect(keywordList(value)).toEqual([]);
        }
    });
});
