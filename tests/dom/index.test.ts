import {beforeEach, describe, expect, it, vi} from "vitest";
import {Plugin, showMessage} from "../support/siyuan";
import {installConfig, makeSettings} from "../support/env";
import {DEFAULT_SETTINGS, SETTINGS_FILE} from "../../src/config";
import EditorPlugin from "../../src/index";
import {openSettingsPanel} from "../../src/settings-panel";
import {registerOpenHandlers} from "../../src/open";
import {registerCloseGuard} from "../../src/close-guard";
import {registerCodeMenu} from "../../src/code-menu";
import {watchCodeTheme} from "../../src/theme";
import {loadHljs} from "../../src/hljs";
import {createView, focusedTab, refreshCodeBlockColors, refreshEditorSettings, watchEditorConfig} from "../../src/view";
import {openPrettierConfig, migratePrettierConfig} from "../../src/prettier-config";

vi.mock("../../src/settings-panel", () => ({openSettingsPanel: vi.fn()}));
vi.mock("../../src/open", () => ({registerOpenHandlers: vi.fn(), TAB_TYPE: "textEditor"}));
vi.mock("../../src/close-guard", () => ({registerCloseGuard: vi.fn()}));
vi.mock("../../src/code-menu", () => ({registerCodeMenu: vi.fn()}));
vi.mock("../../src/theme", () => ({watchCodeTheme: vi.fn()}));
vi.mock("../../src/hljs", () => ({loadHljs: vi.fn()}));
vi.mock("../../src/prettier-config", () => ({
    migratePrettierConfig: vi.fn(),
    openPrettierConfig: vi.fn(),
}));
vi.mock("../../src/view", () => ({
    createView: vi.fn(),
    focusedTab: vi.fn(),
    refreshCodeBlockColors: vi.fn(),
    refreshEditorSettings: vi.fn(),
    watchEditorConfig: vi.fn(),
}));

const i18n = {
    noActiveEditor: "没有打开的编辑器",
    settingsSaved: "设置已保存",
    settingsFailed: "设置保存失败",
    forgotten: "已清除记忆",
};

let plugin: any;

function makePlugin(): any {
    const instance = new (EditorPlugin as any)();
    instance.i18n = i18n;
    instance.displayName = "文本编辑器";
    return instance;
}

beforeEach(() => {
    installConfig();
    plugin = makePlugin();
    vi.mocked(loadHljs).mockResolvedValue(true);
});

describe("onload", () => {
    it("注册图标、页签、菜单、命令与订阅", async () => {
        await plugin.onload();
        expect(plugin.icons).toContain("iconEditorText");
        expect(plugin.tabs).toHaveLength(1);
        expect(plugin.tabs[0].type).toBe("textEditor");
        expect(plugin.commands).toHaveLength(1);
        expect(watchCodeTheme).toHaveBeenCalledWith(plugin, refreshCodeBlockColors);
        expect(watchEditorConfig).toHaveBeenCalledWith(plugin, expect.any(Function));
        expect(registerOpenHandlers).toHaveBeenCalledWith(expect.objectContaining({plugin}));
        expect(registerCloseGuard).toHaveBeenCalledWith(expect.objectContaining({plugin}));
        expect(registerCodeMenu).toHaveBeenCalledWith(expect.objectContaining({plugin}));
        expect(loadHljs).toHaveBeenCalledTimes(1);
        // 升级过渡：加载时就把 prettier 配置建出来（或搬过来）
        expect(migratePrettierConfig).toHaveBeenCalledTimes(1);
    });

    it("没有存档时使用默认设置", async () => {
        await plugin.onload();
        expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("读取并校验存档设置", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        plugin.data.set(SETTINGS_FILE, {
            takeover: "none",
            maxSizeMB: "8",
            debug: true,
            openMode: "preview",
            unknown: "ignored",
        });
        await plugin.onload();
        expect(plugin.settings).toMatchObject({
            takeover: "none",
            maxSizeMB: 8,
            debug: true,
            openMode: "preview",
        });
        expect("unknown" in plugin.settings).toBe(false);
    });

    it("只读工作区里读存档失败也继续加载", async () => {
        vi.spyOn(plugin, "loadData").mockRejectedValue(new Error("read-only"));
        await expect(plugin.onload()).resolves.toBeUndefined();
        expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
        expect(plugin.tabs).toHaveLength(1);
    });

    it("页签工厂建立视图，销毁时释放视图", async () => {
        const view = {dispose: vi.fn()};
        vi.mocked(createView).mockReturnValue(view as any);
        await plugin.onload();
        const model = {element: document.createElement("div"), data: {link: "assets/a.txt"}};
        plugin.tabs[0].init.call(model);
        expect(createView).toHaveBeenCalledWith(
            {
                element: model.element,
                data: model.data,
                // 没有候选文件时操作条不画标题，也没有下拉
                title: undefined,
                files: [],
                onSwitch: expect.any(Function),
            },
            expect.any(Function),
            expect.any(Function),
        );
        expect(view.dispose).not.toHaveBeenCalled();

        plugin.tabs[0].beforeDestroy.call(model);
        expect(view.dispose).toHaveBeenCalledTimes(1);
        // 再销毁一次不应重复释放
        plugin.tabs[0].beforeDestroy.call(model);
        expect(view.dispose).toHaveBeenCalledTimes(1);
    });

    it("候选文件多于一个时画可点标题，切换后更新 data 与页签头", async () => {
        vi.mocked(createView).mockReturnValue({dispose: vi.fn()} as any);
        await plugin.onload();
        const updateTitle = vi.fn();
        const files = [
            {link: "/data/a.json", title: "a.json", workspace: true},
            {link: "/data/b.json", title: "b.json", workspace: true},
        ];
        const model = {
            element: document.createElement("div"),
            tab: {title: "a.json", updateTitle},
            data: {link: "/data/a.json", workspace: true, files},
        };
        plugin.tabs[0].init.call(model);
        const host = vi.mocked(createView).mock.calls[0][0];
        expect(host.title).toBe("a.json");
        expect(host.files).toBe(files);

        host.onSwitch!(files[1]);
        expect(model.data.link).toBe("/data/b.json");
        expect(updateTitle).toHaveBeenCalledWith("b.json");
    });

    it("命令没有页签时提示，有页签时保存", async () => {
        const view = {save: vi.fn(async () => true)};
        vi.mocked(focusedTab).mockReturnValue(undefined as any);
        await plugin.onload();
        const command = plugin.commands[0];
        command.execute();
        expect(showMessage).toHaveBeenCalledWith("没有打开的编辑器");

        vi.mocked(focusedTab).mockReturnValue(view as any);
        command.execute();
        expect(view.save).toHaveBeenCalledTimes(1);
    });

    it("命令只声明 execute，不声明宿主专用的回调字段", async () => {
        await plugin.onload();
        const command = plugin.commands[0];
        expect(command).toMatchObject({langKey: "saveCommand", hotkey: "⌘S"});
        for (const field of ["globalCallback", "fileTreeCallback", "editorCallback", "dockCallback"]) {
            expect(command[field]).toBeUndefined();
        }
    });
});

describe("openSetting", () => {
    beforeEach(async () => {
        await plugin.onload();
    });

    function panelOptions() {
        return vi.mocked(openSettingsPanel).mock.calls[0][0];
    }

    it("用插件显示名打开设置面板", () => {
        plugin.openSetting();
        expect(panelOptions()).toMatchObject({title: "文本编辑器", settings: plugin.settings});
    });

    it("设置面板的 Prettier 配置按钮打开配置编辑器", () => {
        plugin.openSetting();
        panelOptions().onPrettier();
        expect(openPrettierConfig).toHaveBeenCalledWith({
            app: plugin.app,
            plugin,
            t: expect.any(Function),
            settings: expect.any(Function),
        });
    });

    it("保存后写盘、立即生效并提示", async () => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        plugin.openSetting();
        const next = makeSettings({debug: true, openMode: "preview"});
        panelOptions().onSave(next);
        await vi.waitFor(() => expect(plugin.settings).toEqual(next));
        expect(plugin.data.get(SETTINGS_FILE)).toEqual(next);
        expect(refreshEditorSettings).toHaveBeenCalledWith(next);
        expect(showMessage).toHaveBeenCalledWith("设置已保存", 2000);
    });

    it("写盘失败时仍在本进程生效，并提示错误", async () => {
        vi.spyOn(plugin, "saveData").mockRejectedValue(new Error("denied"));
        plugin.openSetting();
        const next = makeSettings({openMode: "preview"});
        panelOptions().onSave(next);
        await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
        expect(plugin.settings).toEqual(next);
        expect(showMessage).toHaveBeenCalledWith("设置保存失败: denied", 6000, "error");
        expect(refreshEditorSettings).not.toHaveBeenCalled();
    });

    it("清除记忆时清空存储并提示", () => {
        plugin.openSetting();
        panelOptions().onForget();
        expect(showMessage).toHaveBeenCalledWith("已清除记忆", 3000);
    });
});
