import {describe, expect, it, vi} from "vitest";
import {Menu} from "../support/siyuan";
import {openFileMenu} from "../../src/menus/file-menu";

const FILES = [
    {link: "/data/a.json", title: "a.json", workspace: true},
    {link: "/data/b.json", title: "b.json", workspace: true},
];

const lastMenu = (): Menu => Menu.instances[Menu.instances.length - 1];

describe("openFileMenu", () => {
    it("列出全部候选，当前文件打勾", () => {
        openFileMenu(document.createElement("span"), FILES, "/data/b.json", vi.fn());
        const menu = lastMenu();
        expect(menu.items.map((item) => item.id)).toEqual(["/data/a.json", "/data/b.json"]);
        expect(menu.items.map((item) => item.label)).toEqual(["a.json", "b.json"]);
        expect(menu.items.map((item) => item.current)).toEqual([false, true]);
    });

    it("文件名按 HTML 转义后再交给宿主", () => {
        openFileMenu(
            document.createElement("span"),
            [{link: "/data/a.json", title: "<b>a</b>.json"}],
            "/data/a.json",
            vi.fn(),
        );
        expect(lastMenu().items[0].label).toBe("&lt;b&gt;a&lt;/b&gt;.json");
    });

    it("每项用文件自己的语言图标", () => {
        openFileMenu(
            document.createElement("span"),
            [
                {link: "/data/a.py", title: "a.py", workspace: true},
                {link: "/data/b.md", title: "b.md", workspace: true},
            ],
            "/data/a.py",
            vi.fn(),
        );
        expect(lastMenu().items.map((item) => item.icon)).toEqual([
            "iconEditorFilePython",
            "iconEditorFileMarkdown",
        ]);
    });

    it("点一项就把那个文件交回调用方", () => {
        const onPick = vi.fn();
        openFileMenu(document.createElement("span"), FILES, "/data/a.json", onPick);
        lastMenu().items[1].click!();
        expect(onPick).toHaveBeenCalledWith(FILES[1]);
    });

    it("贴着标题打开", () => {
        const anchor = document.createElement("span");
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
            left: 5,
            bottom: 10,
            width: 40,
            height: 20,
            top: -10,
            right: 45,
            x: 5,
            y: -10,
            toJSON: () => ({}),
        } as DOMRect);
        openFileMenu(anchor, FILES, "/data/a.json", vi.fn());
        expect(lastMenu().openOptions).toEqual({x: 5, y: 10, h: 20, w: 40});
    });
});
