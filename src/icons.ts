/**
 * 插件自带的图标。
 *
 * 规格对齐思源默认图标集（appearance/icons/litheness）：24x24 viewBox、
 * 无填充、stroke 取 currentColor、线宽 1.7、圆头圆角。这样页签头、右键菜单
 * 里的颜色与线宽都与旁边的内置图标一致。
 *
 * 图形与 assets/icon.svg 同构：一对等宽方括号夹一个光标条。方括号是「引用」的语法，
 * 光标条是「编辑」的隐喻。市集那张 160x160 的图标带 #3575f0 直角底色，
 * 这里不带底色：顶栏与页签头里只有 16 到 18 像素，带底色的图形会被背景吃掉轮廓。
 *
 * 保存图标思源没有（它全部自动保存，没有任何保存按钮的先例），
 * 按官方插件文档的做法从 Lucide 取 save，只改线宽等属性，路径数据保持原样。
 */

export const ICON_TAB = "iconEditorText";
export const ICON_SAVE = "iconEditorSave";

const STROKE = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;

export const ICONS = `<symbol id="${ICON_TAB}" viewBox="0 0 24 24" ${STROKE}>
<path d="M9.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h2.5"/>
<path d="M14.5 4.5H17A2.5 2.5 0 0 1 19.5 7v10A2.5 2.5 0 0 1 17 19.5h-2.5"/>
<path d="M12 8v8"/>
</symbol>
<symbol id="${ICON_SAVE}" viewBox="0 0 24 24" ${STROKE}>
<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>
<path d="M7 3v4a1 1 0 0 0 1 1h7"/>
</symbol>`;
