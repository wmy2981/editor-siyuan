/**
 * i18n 取值与参数插值。
 *
 * 思源在插件加载时只注入当前语言的一份 i18n 表（`this.i18n`，值可能是任意 JSON），
 * 缺失的键会得到 undefined，所以这里统一回退为键名本身，便于发现漏配。
 */

export type I18n = Record<string, unknown>;

export function makeT(i18n: I18n) {
    return function t(key: string, params?: Record<string, string | number>): string {
        const value = i18n[key];
        let text = typeof value === "string" ? value : key;
        if (params) {
            for (const [name, item] of Object.entries(params)) {
                text = text.replaceAll(`{${name}}`, String(item));
            }
        }
        return text;
    };
}

export type T = ReturnType<typeof makeT>;
