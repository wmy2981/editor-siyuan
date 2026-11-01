/**
 * `siyuan` 包只提供类型声明，运行时代码由宿主注入（vite.config.ts 把它标成 external）。
 * 测试里通过 vitest.config.ts 的 alias 换成本文件：只实现插件真正用到的那几个类与函数，
 * 并额外暴露实例列表与工厂函数，让测试可以断言宿主收到了什么。
 *
 * 注意：测试要直接 import 本文件，而不是 `from "siyuan"`。两条路径指向同一个模块实例
 * （alias 指向的正是这个文件），所以静态实例列表是共享的。
 */
import {vi} from "vitest";

export interface IMenu {
    id?: string;
    label?: string;
    icon?: string;
    iconHTML?: string;
    accelerator?: string;
    disabled?: boolean;
    type?: string;
    click?: () => void;
    bind?: (element: HTMLElement) => void;
}

type THandler = (event: CustomEvent<any>) => void;

export class EventBus {
    private readonly handlers = new Map<string, Set<THandler>>();

    on(type: string, handler: THandler): void {
        let set = this.handlers.get(type);
        if (!set) {
            set = new Set();
            this.handlers.set(type, set);
        }
        set.add(handler);
    }

    off(type: string, handler: THandler): void {
        this.handlers.get(type)?.delete(handler);
    }

    /** 测试用：按宿主的方式派发一个 CustomEvent，返回事件本身便于检查 preventDefault。 */
    emit(type: string, detail?: unknown): CustomEvent {
        const event = new CustomEvent(type, {detail, cancelable: true});
        for (const handler of [...(this.handlers.get(type) ?? [])]) {
            handler(event);
        }
        return event;
    }

    clear(): void {
        this.handlers.clear();
    }
}

export class Plugin {
    static readonly instances: Plugin[] = [];

    app: Record<string, unknown> = {};
    name = "editor-siyuan";
    i18n: Record<string, unknown> = {};
    displayName = "Editor";
    readonly eventBus = new EventBus();
    readonly data = new Map<string, unknown>();
    readonly tabs: Array<Record<string, any>> = [];
    readonly commands: Array<Record<string, any>> = [];
    icons = "";
    openedTabs: Record<string, Array<Record<string, any>>> = {};

    constructor() {
        Plugin.instances.push(this);
    }

    addIcons(icons: string): void {
        this.icons = icons;
    }

    async loadData(name: string): Promise<unknown> {
        return this.data.get(name);
    }

    async saveData(name: string, value: unknown): Promise<void> {
        this.data.set(name, value);
    }

    addTab(spec: Record<string, any>): void {
        this.tabs.push(spec);
    }

    addCommand(command: Record<string, any>): void {
        this.commands.push(command);
    }

    getOpenedTab(): Record<string, Array<Record<string, any>>> {
        return this.openedTabs;
    }
}

export const showMessage = vi.fn();

export class Menu {
    static readonly instances: Menu[] = [];

    readonly element = document.createElement("div");
    readonly items: IMenu[] = [];
    opened = false;
    openOptions: Record<string, unknown> | undefined;
    closed = false;

    constructor() {
        Menu.instances.push(this);
    }

    addItem(item: IMenu): HTMLElement {
        this.items.push(item);
        const element = document.createElement("div");
        element.className = "b3-menu__item";
        if (item.id) {
            element.dataset.id = item.id;
        }
        if (item.label !== undefined) {
            // 语言选择器把整段 HTML 放在 label 里并显式给 iconHTML: ""；
            // 其余菜单项是纯文本。
            if (item.iconHTML === "") {
                element.innerHTML = item.label;
            } else {
                element.textContent = item.label;
            }
        }
        if (item.disabled) {
            element.classList.add("b3-menu__item--disabled");
        }
        this.element.append(element);
        item.bind?.(element);
        return element;
    }

    addSeparator(): HTMLElement {
        const element = document.createElement("div");
        element.className = "b3-menu__separator";
        this.element.append(element);
        return element;
    }

    open(options?: Record<string, unknown>): void {
        this.opened = true;
        this.openOptions = options;
    }

    close(): void {
        this.closed = true;
        this.opened = false;
    }
}

export interface IDialogOptions {
    title?: string;
    width?: string;
    height?: string;
    content?: string;
    disableClose?: boolean;
    hideCloseIcon?: boolean;
    destroyCallback?: () => void;
}

export class Dialog {
    static readonly instances: Dialog[] = [];

    readonly element = document.createElement("div");
    readonly options: IDialogOptions;
    destroyed = false;

    constructor(options: IDialogOptions) {
        this.options = options;
        this.element.className = "b3-dialog";
        // 与宿主的 DOM 一致：遮罩、容器、关闭图标、标题栏（无标题时 fn__none）与正文都在这一层，
        // 插件靠选择器取它们，也靠标题栏证明「原生弹窗外观」还在。
        this.element.innerHTML = `<div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container">
  <svg class="b3-dialog__close"></svg>
  <div class="b3-dialog__header${options.title ? "" : " fn__none"}">${options.title ?? ""}</div>
  <div class="b3-dialog__body">${options.content ?? ""}</div>
</div>`;
        document.body.append(this.element);
        Dialog.instances.push(this);
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.element.remove();
        this.options.destroyCallback?.();
    }
}

export const openTab = vi.fn(async (_options?: Record<string, unknown>) => ({}));

let activeTab: Record<string, any> | undefined;

export const getActiveTab = (): Record<string, any> | undefined => activeTab;

export function __setActiveTab(tab: Record<string, any> | undefined): void {
    activeTab = tab;
}

let frontend = "desktop";

export const getFrontend = (): string => frontend;

export function __setFrontend(value: string): void {
    frontend = value;
}

export const ProtyleMethod = {
    highlightRender: vi.fn(),
};

/** 每个测试前把静态状态清干净；由 tests/support/setup.ts 调用。 */
export function resetSiyuanMock(): void {
    Plugin.instances.length = 0;
    Menu.instances.length = 0;
    Dialog.instances.length = 0;
    activeTab = undefined;
    frontend = "desktop";
}
