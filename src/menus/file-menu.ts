/**
 * 标题下拉：在同一个窗口里换一个文件。
 *
 * 只有调用方给出一组候选文件时才会出现（见 open.ts 的 openFileList），默认没有下拉。
 * 菜单用思源原生的 Menu，当前文件用宿主给的 `current` 打勾（.b3-menu__item--selected），
 * 与思源自己的列表一致。
 */
import {Menu} from "siyuan";
import {fileIcon} from "../files/file-icon";
import {escapeHtml} from "../core/util";
import type {IViewFile} from "../views/view";

export function openFileMenu(
    anchor: HTMLElement,
    files: IViewFile[],
    currentLink: string,
    onPick: (file: IViewFile) => void,
): void {
    const menu = new Menu();
    for (const file of files) {
        menu.addItem({
            id: file.link,
            icon: fileIcon(file.link),
            // 宿主的 Menu 把 label 当 HTML 插进菜单项，文件名必须转义
            label: escapeHtml(file.title),
            current: file.link === currentLink,
            click: () => onPick(file),
        });
    }
    const rect = anchor.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
}
