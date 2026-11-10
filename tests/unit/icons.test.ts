import {describe, expect, it} from "vitest";
import {ICONS, ICON_SAVE, ICON_TAB, ICON_WRAP} from "../../src/core/icons";

describe("icons", () => {
    it("暴露三个固定的 symbol id", () => {
        expect(ICON_TAB).toBe("iconEditorText");
        expect(ICON_SAVE).toBe("iconEditorSave");
        expect(ICON_WRAP).toBe("iconEditorWrap");
    });

    it("symbol 的 id 与导出的常量一致", () => {
        expect(ICONS).toContain(`<symbol id="${ICON_TAB}"`);
        expect(ICONS).toContain(`<symbol id="${ICON_SAVE}"`);
        expect(ICONS).toContain(`<symbol id="${ICON_WRAP}"`);
    });

    it("使用 24x24 viewBox、描边而非填充", () => {
        const symbols = ICONS.match(/<symbol[^>]*>/g) ?? [];
        expect(symbols).toHaveLength(3);
        for (const symbol of symbols) {
            expect(symbol).toContain('viewBox="0 0 24 24"');
            expect(symbol).toContain('fill="none"');
            expect(symbol).toContain('stroke="currentColor"');
            expect(symbol).toContain('stroke-width="1.7"');
            expect(symbol).toContain('stroke-linecap="round"');
            expect(symbol).toContain('stroke-linejoin="round"');
        }
    });

    it("每个 symbol 都有路径", () => {
        expect(ICONS.match(/<path /g)).toHaveLength(10);
    });
});
