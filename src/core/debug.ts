/**
 * 调试日志。
 *
 * 默认关闭，在设置面板里打开后，插件在关键节点往浏览器控制台输出一行日志：
 * 设置载入与保存、接管手势的判定、文件定位与体积、高亮引擎、编辑器装配、
 * 保存与暂存、菜单注册。用来回答「为什么这次点击没有接管」「为什么没有上色」
 * 这类只看界面看不出来的问题。
 *
 * 用 console.log 而不是 console.debug：后者在部分控制台里归进 Verbose 一档，
 * 默认是收起来的，而调试模式的前提是「打开就能看见」。
 */

const PREFIX = "[editor-siyuan]";

let enabled = false;

export function setDebug(value: boolean): void {
    enabled = value;
}

/** 只有调试模式打开时才真的往控制台写。 */
export function debug(...args: unknown[]): void {
    if (enabled) {
        console.log(PREFIX, ...args);
    }
}
