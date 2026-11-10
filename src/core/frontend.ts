/**
 * 当前前端类型。
 *
 * 宿主把「跑在哪种前端上」做成了编译期常量（app/src/util/functions.ts 的 getFrontend），
 * 插件只能问宿主要。不要自己按 UA 或窗口宽度判断：桌面端也可能把窗口缩得很窄，
 * 而手机浏览器（browser-mobile）与手机 App（mobile）是两种前端，能力并不完全一样。
 */
import {getFrontend} from "siyuan";

export type TFrontend = ReturnType<typeof getFrontend>;

export const frontend = (): TFrontend => getFrontend();

/**
 * 浏览器前端：Docker 部署与网页版。没有 Electron，也就没有本地文件系统、
 * 原生菜单与可拦截的窗口关闭动作。
 */
export const isBrowserFrontend = (): boolean => frontend().startsWith("browser");

/**
 * 移动端：手机 App（mobile）与手机浏览器（browser-mobile）。
 *
 * 这两者的自定义页签 API 都是空实现（宿主的 addTab / openTab 在移动端构建里
 * 被编译掉了），编辑器只能挂进对话框。
 */
export const isMobileFrontend = (): boolean => frontend().endsWith("mobile");

/**
 * 思源弹出的独立窗口（`desktop-window`）。
 *
 * 它是桌面端，但只有那一篇文档的容器、没有主窗口的页签栏，
 * 插件注册的自定义页签在那里落不下来，所以编辑器改挂浮层，见 popup.ts。
 */
export const isSeparateWindow = (): boolean => frontend() === "desktop-window";
