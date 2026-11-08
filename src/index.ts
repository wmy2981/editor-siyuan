/**
 * 插件入口。
 *
 * 启动顺序上有两处不能颠倒：
 * - addIcons 必须在 addTab / 菜单项之前，否则页签头与菜单里的 <use xlink:href> 找不到符号；
 * - addTab 必须在任何 openTab 之前，宿主按「插件名 + 类型」注册模型工厂，
 *   没有工厂的自定义页签会被启动清理逻辑删掉。
 */
import {Plugin, showMessage, type Custom} from "siyuan";
import "./index.scss";
import {DEFAULT_SETTINGS, forgetMemories, initStore, needsExtensionMigration, normalizeSettings, SETTINGS_FILE, type Settings} from "./config";
import {debug, setDebug} from "./debug";
import {ICONS} from "./icons";
import {makeT, type T} from "./i18n";
import {loadHljs} from "./hljs";
import {registerOpenHandlers, TAB_TYPE} from "./open";
import {openSettingsPanel} from "./settings-panel";
import {registerCloseGuard} from "./close-guard";
import {registerCodeMenu} from "./code-menu";
import {watchCodeTheme} from "./theme";
import {config} from "./util";
import {createView, focusedTab, refreshCodeBlockColors, refreshEditorSettings, watchEditorConfig, type IEditorTab, type IViewFile} from "./view";

export default class EditorPlugin extends Plugin {
    private settings: Settings = {...DEFAULT_SETTINGS};
    private t: T = makeT({});
    /** 页签模型 → 视图。beforeDestroy 拿到的就是同一个模型对象，用它精确对应。 */
    private views = new WeakMap<Custom, IEditorTab>();

    async onload(): Promise<void> {
        this.t = makeT(this.i18n);
        this.addIcons(ICONS);
        await initStore(this);
        // 只读模式下 loadData 会 reject，取不到就退回默认值，不能让插件整体加载失败
        let stored: unknown;
        try {
            stored = await this.loadData(SETTINGS_FILE);
        } catch {
            stored = undefined;
        }
        this.settings = normalizeSettings(stored);
        // 旧版本的设置里存的是当时的默认白名单：新内建支持的扩展名已在 normalize 时补进
        // this.settings，这里落盘一次，之后用户自己删掉的条目就不会被再塞回来
        if (needsExtensionMigration(stored)) {
            void this.saveData(SETTINGS_FILE, this.settings).catch(() => {
                // 只读模式下写不进去，下次启动再补一次即可
            });
        }
        setDebug(this.settings.debug);
        debug("loaded", {
            plugin: this.name,
            settings: this.settings,
            editor: {
                codeLineWrap: config().editor.codeLineWrap,
                codeLigatures: config().editor.codeLigatures,
                codeSyntaxHighlightLineNum: config().editor.codeSyntaxHighlightLineNum,
                codeTabSpaces: config().editor.codeTabSpaces,
            },
            workspaceDir: config().system?.workspaceDir,
        });

        watchCodeTheme(this, refreshCodeBlockColors);
        // 思源自己的编辑器设置改了之后，「跟随思源设置」的那几项也要跟着变
        watchEditorConfig(this, () => this.settings);
        // 思源只在渲染过代码块后才加载 highlight.js，这里先把它备好，第一次打开页签就能直接上色
        void loadHljs();

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                // 页签头自己显示标题，关闭由 close-guard 负责，所以这里只给容器与数据
                const data = this.data as {
                    link?: string;
                    sy?: boolean;
                    workspace?: boolean;
                    files?: IViewFile[];
                };
                const files = data.files ?? [];
                plugin.views.set(this, createView({
                    element: this.element,
                    data,
                    // 给了候选文件时操作条上再画一条可点的标题：页签头那份改不动，下拉只能挂在这里
                    title: files.length > 1 ? (this.tab?.title ?? String(data.link ?? "")) : undefined,
                    files,
                    onSwitch: (file) => {
                        // 页签头与 data 一起改：关闭确认与「已经打开就聚焦」都靠 data.link
                        data.link = file.link;
                        this.tab?.updateTitle(file.title);
                    },
                }, plugin.t, () => plugin.settings));
            },
            beforeDestroy() {
                plugin.views.get(this)?.dispose();
                plugin.views.delete(this);
            },
        });

        registerOpenHandlers({
            app: this.app,
            plugin: this,
            t: this.t,
            settings: () => this.settings,
        });
        registerCloseGuard({
            plugin: this,
            t: this.t,
            settings: () => this.settings,
        });
        registerCodeMenu({
            plugin: this,
            t: this.t,
            settings: () => this.settings,
        });

        this.addCommand({
            langKey: "saveCommand",
            hotkey: "⌘S",
            execute: () => {
                const view = focusedTab();
                if (!view) {
                    showMessage(this.t("noActiveEditor"));
                    return;
                }
                void view.save();
            },
        });
    }

    /** 覆盖它才会在「设置 > 集市 > 已下载」里出现设置入口。 */
    openSetting(): void {
        openSettingsPanel({
            title: this.displayName,
            t: this.t,
            settings: this.settings,
            onSave: (next) => {
                void this.applySettings(next);
            },
            onForget: () => {
                forgetMemories();
                showMessage(this.t("forgotten"), 3000);
            },
        });
    }

    private async applySettings(next: Settings): Promise<void> {
        this.settings = next;
        setDebug(next.debug);
        debug("settings saved", next);
        try {
            await this.saveData(SETTINGS_FILE, next);
        } catch (error) {
            // 只读模式下写盘会被拒；设置本身仍在本进程内生效
            showMessage(`${this.t("settingsFailed")}: ${error instanceof Error ? error.message : String(error)}`, 6000, "error");
            return;
        }
        refreshEditorSettings(next);
        showMessage(this.t("settingsSaved"), 2000);
    }
}
