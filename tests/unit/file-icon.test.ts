import {describe, expect, it, vi} from "vitest";
import {fileIcon, updateTabIcon} from "../../src/files/file-icon";
import {FILE_ICONS, FILE_ICON_BY_EXTENSION, FILE_ICON_BY_LANGUAGE, FILE_ICON_BY_NAME} from "../../src/files/file-icons";
import {ICON_TAB} from "../../src/core/icons";

/** FILE_ICONS 里注册过的 symbol id。 */
const registered = new Set(
    Array.from(FILE_ICONS.matchAll(/<symbol id="([^"]+)"/g), (match) => match[1]),
);

describe("fileIcon", () => {
    it("按语言给扩展名配图标", () => {
        expect(fileIcon("assets/a.ts")).toBe("iconEditorFileTypescript");
        expect(fileIcon("assets/a.py")).toBe("iconEditorFilePython");
        expect(fileIcon("assets/a.cs")).toBe("iconEditorFileCSharp");
        expect(fileIcon("assets/a.sql")).toBe("iconEditorFileDb");
        expect(fileIcon("assets/a.yaml")).toBe("iconEditorFileYml");
        expect(fileIcon("assets/a.md")).toBe("iconEditorFileMarkdown");
        expect(fileIcon("assets/a.json")).toBe("iconEditorFileJson");
        expect(fileIcon("assets/a.toml")).toBe("iconEditorFileConfig");
        expect(fileIcon("assets/a.ini")).toBe("iconEditorFileConfig");
    });

    it("文件名映射优先于扩展名", () => {
        expect(fileIcon("assets/README.md")).toBe("iconEditorFileInfo");
        expect(fileIcon("assets/LICENSE")).toBe("iconEditorFileLicense");
        expect(fileIcon("assets/tsconfig.json")).toBe("iconEditorFileTsconfig");
    });

    it("复合扩展名优先于最后一段", () => {
        expect(fileIcon("assets/a.test.jsx")).toBe("iconEditorFileReact1");
        expect(fileIcon("assets/a.spec.ts")).toBe("iconEditorFileTypescript1");
    });

    it("无扩展名的常见文件按语言归属", () => {
        expect(fileIcon("assets/Dockerfile")).toBe("iconEditorFileDocker");
        expect(fileIcon("assets/Makefile")).toBe("iconEditorFileMakefile");
        expect(fileIcon("assets/.gitignore")).toBe("iconEditorFileGit");
        expect(fileIcon("assets/.prettierignore")).toBe("iconEditorFileGit");
    });

    it("大小写、查询串与目录都不影响结果", () => {
        expect(fileIcon("assets/A.PY")).toBe("iconEditorFilePython");
        expect(fileIcon("assets/a.ts?box=20210808180117")).toBe("iconEditorFileTypescript");
        expect(fileIcon("/data/box/assets/a.ts#L1")).toBe("iconEditorFileTypescript");
    });

    it(".sy 用思源的默认文档图标", () => {
        expect(fileIcon("/data/20210808180117-czj9bvb/20241101120000-abc.sy")).toBe("iconFile");
        expect(fileIcon("/data/box/a.SY?box=20210808180117")).toBe("iconFile");
    });

    it("认不出来时回退插件自己的图标", () => {
        expect(fileIcon("assets/a.txt")).toBe(ICON_TAB);
        expect(fileIcon("assets/a.unknown")).toBe(ICON_TAB);
        expect(fileIcon("")).toBe(ICON_TAB);
    });

    it("所有映射都指向已注册的 symbol", () => {
        for (const table of [FILE_ICON_BY_NAME, FILE_ICON_BY_EXTENSION, FILE_ICON_BY_LANGUAGE]) {
            for (const id of Object.values(table)) {
                expect(registered.has(id), id).toBe(true);
            }
        }
    });
});

describe("updateTabIcon", () => {
    function tabWithUse(icon: string) {
        const headElement = document.createElement("div");
        headElement.innerHTML = `<svg class="item__graphic"><use xlink:href="#${icon}"></use></svg>`;
        return {icon, headElement};
    }

    it("同时改 tab.icon 与头部 <use> 的引用", () => {
        const tab = tabWithUse(ICON_TAB);
        updateTabIcon(tab, "iconEditorFileJson");
        expect(tab.icon).toBe("iconEditorFileJson");
        expect(tab.headElement.querySelector("use")!.getAttribute("xlink:href")).toBe("#iconEditorFileJson");
    });

    it("图标没变时不碰 DOM", () => {
        const tab = tabWithUse(ICON_TAB);
        const use = tab.headElement.querySelector("use")!;
        const setAttributeNS = vi.spyOn(use, "setAttributeNS");
        updateTabIcon(tab, ICON_TAB);
        expect(setAttributeNS).not.toHaveBeenCalled();
    });

    it("没有页签或没有图标元素时静默跳过", () => {
        expect(() => updateTabIcon(undefined, "iconEditorFileJson")).not.toThrow();
        const tab = {icon: ICON_TAB, headElement: document.createElement("div")};
        expect(() => updateTabIcon(tab, "iconEditorFileJson")).not.toThrow();
        expect(tab.icon).toBe("iconEditorFileJson");
    });
});
