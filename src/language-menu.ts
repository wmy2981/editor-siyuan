/**
 * 语言选择器。
 *
 * 代码块左上角的语言标签是可点的，点开是语言菜单；这里做同一件事：
 * 用思源原生的 Menu，配一个可搜索的列表——hljs 支持的语言有二百多个，
 * 直接列出来太长。筛选列表的写法取自思源 AI 设置里选模型的那个下拉。
 */
import {Menu} from "siyuan";
import {availableLanguages} from "./language";
import {escapeHtml} from "./util";
import type {T} from "./i18n";

/** 上下键在可见条目间移动高亮，跳过被搜索过滤掉的。 */
function moveFocus(list: HTMLElement, event: KeyboardEvent): void {
    const items = Array.from(list.querySelectorAll<HTMLElement>(".b3-list-item"))
        .filter((item) => !item.classList.contains("fn__none"));
    if (items.length === 0) {
        return;
    }
    const current = items.findIndex((item) => item.classList.contains("b3-list-item--focus"));
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = items[(current + step + items.length) % items.length];
    items.forEach((item) => item.classList.remove("b3-list-item--focus"));
    next.classList.add("b3-list-item--focus");
    next.scrollIntoView({block: "nearest"});
    event.preventDefault();
    event.stopPropagation();
}

export function openLanguageMenu(anchor: HTMLElement, current: string, t: T, onPick: (language: string) => void): void {
    const menu = new Menu();
    const element = menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter editor-siyuan__lang-filter">
    <input class="b3-text-field fn__block" placeholder="${escapeHtml(t("languageSearch"))}">
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">
        ${availableLanguages().map((name) => `<div class="b3-list-item b3-list-item--narrow" data-language="${escapeHtml(name)}">
    <span class="b3-list-item__text">${escapeHtml(name)}</span>
    ${name === current ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
</div>`).join("")}
        <div class="b3-list--empty fn__none" data-type="empty">${escapeHtml(t("languageEmpty"))}</div>
    </div>
</div>`,
        bind(item) {
            const list = item.querySelector<HTMLElement>(".b3-list");
            const search = item.querySelector<HTMLInputElement>("input");
            const empty = item.querySelector<HTMLElement>("[data-type='empty']");
            if (!list || !search || !empty) {
                return;
            }
            const pick = (target: HTMLElement) => {
                onPick(target.dataset.language ?? "");
                menu.close();
                anchor.focus();
            };
            const filter = () => {
                const keyword = search.value.toLowerCase().trim();
                let first: HTMLElement | undefined;
                list.querySelectorAll<HTMLElement>(".b3-list-item").forEach((item) => {
                    item.classList.remove("b3-list-item--focus");
                    const hidden = !(item.dataset.language ?? "").toLowerCase().includes(keyword);
                    item.classList.toggle("fn__none", hidden);
                    if (!hidden && !first) {
                        first = item;
                    }
                });
                first?.classList.add("b3-list-item--focus");
                empty.classList.toggle("fn__none", first !== undefined);
            };
            filter();
            search.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    moveFocus(list, event);
                } else if (event.key === "Enter") {
                    const target = list.querySelector<HTMLElement>(".b3-list-item--focus");
                    if (target) {
                        pick(target);
                    }
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    menu.close();
                    anchor.focus();
                    event.preventDefault();
                }
            });
            search.addEventListener("input", () => {
                filter();
            });
            list.addEventListener("click", (event) => {
                const target = (event.target as HTMLElement).closest<HTMLElement>(".b3-list-item");
                if (target) {
                    pick(target);
                }
            });
        },
    });
    const rect = anchor.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
    // Menu.open 的 w 只参与水平溢出修正，实际宽度由内容决定；
    // 语言名长短不一，给一个下限免得菜单被最短的那一项决定宽度。
    menu.element.style.boxSizing = "border-box";
    menu.element.style.width = `${Math.max(rect.width, 260)}px`;
    element.querySelector<HTMLInputElement>("input")?.focus();
}
