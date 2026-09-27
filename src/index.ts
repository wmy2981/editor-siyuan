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
import {DEFAULT_SETTINGS, forgetMemories, initStore, normalizeSettings, SETTINGS_FILE, type Settings} from "./config";
import {ICONS} from "./icons";
import {makeT, type T} from "./i18n";
import {loadHljs} from "./hljs";
import {registerOpenHandlers, TAB_TYPE} from "./open";
import {openSettingsPanel} from "./settings-panel";
import {registerCloseGuard} from "./close-guard";
import {watchCodeTheme} from "./theme";
import {createView, focusedTab, refreshLineNumbers, type IEditorTab} from "./view";

export default class EditorPlugin extends Plugin {
    private settings: Settings = {...DEFAULT_SETTINGS};
    private t: T = makeT({});
    /** 页签模型 → 视图。beforeDestroy 拿到的就是同一个模型对象，用它精确对应。 */
    private views = new WeakMap<Custom, IEditorTab>();

    async onload(): Promise<void> {
        this.t = makeT(this.i18n);
        this.addIcons(ICONS);
        await initStore(this);
        this.settings = normalizeSettings(await this.loadData(SETTINGS_FILE));

        watchCodeTheme(this);
        // 思源只在渲染过代码块后才加载 highlight.js，这里先把它备好，第一次打开页签就能直接上色
        void loadHljs();

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                plugin.views.set(this, createView(this, plugin.t, () => plugin.settings));
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
        await this.saveData(SETTINGS_FILE, next);
        refreshLineNumbers(next);
        showMessage(this.t("settingsSaved"), 2000);
    }
}
