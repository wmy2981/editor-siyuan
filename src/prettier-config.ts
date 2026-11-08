/**
 * prettier 的自定义配置。
 *
 * prettier 的浏览器构建没有 fs，`resolveConfig` 用不了，所以配置由插件自己读：
 * 两个文件放在插件的存储目录 `data/storage/petal/editor-siyuan/` 下，用户在
 * 「设置 - 插件 - Editor」里点「编辑配置」直接改（那个窗口带标题下拉，可以在两个文件之间切换，
 * 见 file-menu.ts）。
 *
 * - `.prettierrc.json`：prettier 的顶层选项，原样并进 `format` 的 options；
 * - `.prettierignore`：gitignore 风格的排除清单，命中的文件不格式化。
 *
 * 配置文件不存在时先按默认值写一份：插件加载、格式化与打开编辑器都会把它建出来，用户看到的
 * 是能直接改的内容，而不是一个空文件。默认值只有缩进两项，取思源「代码块 Tab 空格数」，其余交给
 * prettier 自己的默认值；落盘之后就以文件为准，思源里的 Tab 空格数再改也不影响格式化。
 * 从没有配置文件的旧版本升级上来时，因此不会改变格式化结果（见 migratePrettierConfig）。
 */
import {readWorkspaceText, writeWorkspaceText} from "./asset";
import {isMobileFrontend} from "./frontend";
import {openMobileEditor} from "./mobile";
import {openPopupEditor} from "./popup";
import {baseName, config} from "./util";
import type {IOpenDeps} from "./open";
import type {IViewFile} from "./view";
import type {T} from "./i18n";

/** 插件自己的存储目录，与 loadData / saveData 落盘的位置相同。 */
const DATA_DIR = "/data/storage/petal/editor-siyuan";
const CONFIG_PATH = `${DATA_DIR}/.prettierrc.json`;
const IGNORE_PATH = `${DATA_DIR}/.prettierignore`;

/** 标题下拉里的候选文件；两个都允许还不存在（第一次打开时按默认值建出来）。 */
export const PRETTIER_FILES: IViewFile[] = [
    {link: CONFIG_PATH, title: ".prettierrc.json", workspace: true, allowMissing: true},
    {link: IGNORE_PATH, title: ".prettierignore", workspace: true, allowMissing: true},
];

/**
 * 默认配置。
 *
 * 只写插件自己会算的两项，别的选项留空，交给 prettier 的默认值：写满一整份反而会把
 * prettier 将来的默认值一起冻住。缩进取思源的「代码块 Tab 空格数」，与以前不读配置文件时一致。
 */
function defaultOptions(): Record<string, unknown> {
    const tabSpaces = config().editor.codeTabSpaces;
    return {tabWidth: tabSpaces === 0 ? 4 : tabSpaces, useTabs: tabSpaces === 0};
}

const defaultText = (): string => `${JSON.stringify(defaultOptions(), null, 4)}\n`;

/** 读配置原文；文件不存在时先写一份默认值，再返回这份默认值。 */
async function configText(): Promise<string> {
    const existing = await readWorkspaceText(CONFIG_PATH);
    if (existing) {
        return existing.text;
    }
    const text = defaultText();
    // 只读角色写不进去：不影响这次格式化，照样用这份默认值
    await writeWorkspaceText(CONFIG_PATH, text);
    return text;
}

/** 确保配置文件存在（打开配置编辑器之前调一次，免得用户看到一个空文件）。 */
export async function ensurePrettierConfig(): Promise<void> {
    await configText();
}

/** 早先的开发版把这两个文件放在工作区 `data/` 根下；升级时把它们的内容搬进插件目录。 */
const LEGACY_FILES: Array<[string, string]> = [
    ["/data/.prettierrc.json", CONFIG_PATH],
    ["/data/.prettierignore", IGNORE_PATH],
];

/**
 * 升级过渡。
 *
 * 1.3.2 及更早的版本没有 prettier 配置文件，格式化用的是思源的「代码块 Tab 空格数」：
 * 升级后先按同样的缩进把默认配置建出来，格式化结果不变，用户也能直接看到并调整。
 * 更早的开发版把这两个文件放在工作区 `data/` 根下，那里有内容就搬进插件目录——原件不动，
 * 万一用户自己也放了一份同名的。空文件不算内容：那可能是用户故意清空的，也可能是没写过的。
 */
export async function migratePrettierConfig(): Promise<void> {
    for (const [legacy, current] of LEGACY_FILES) {
        const existing = await readWorkspaceText(current);
        if (existing && existing.text.trim() !== "") {
            continue;
        }
        const old = await readWorkspaceText(legacy);
        if (!old || old.text.trim() === "") {
            continue;
        }
        await writeWorkspaceText(current, old.text);
    }
    await ensurePrettierConfig();
}

/**
 * 打开配置编辑器。
 *
 * 它属于设置的一部分，不该占一个页签，所以桌面端固定用浮层、移动端用全屏对话框，
 * 与「桌面端形态」那一项无关。
 */
export function openPrettierConfig(deps: IOpenDeps): void {
    const configFile = PRETTIER_FILES[0];
    const data = {link: configFile.link, workspace: true};
    const open = (): void => {
        if (isMobileFrontend()) {
            openMobileEditor(deps, data, configFile.title, PRETTIER_FILES);
            return;
        }
        openPopupEditor(deps, data, configFile.title, PRETTIER_FILES);
    };
    void (async () => {
        try {
            await ensurePrettierConfig();
        } catch {
            // 只读角色建不出来：照样打开，用户能看到内容，保存时再报错
        }
        open();
    })();
}

/**
 * 格式化前的准备：读配置、查排除清单，返回要并进 `format` 的选项。
 *
 * 返回 undefined 表示这个文件被 `.prettierignore` 排除了，调用方据此跳过并提示。
 * 配置存在但不是合法的 JSON 对象时抛错，错误信息已经是可以直接展示的文案。
 * 没有 apiPath 时不查排除清单（笔记里的代码块没有文件路径）。
 */
export async function prepareFormat(t: T, apiPath?: string): Promise<Record<string, unknown> | undefined> {
    if (apiPath) {
        const ignore = (await readWorkspaceText(IGNORE_PATH))?.text ?? "";
        if (ignoredBy(ignore, apiPath)) {
            return undefined;
        }
    }
    const raw = (await configText()).trim();
    // 空文件表示「一项都不设」，全部交给 prettier 的默认值
    if (raw === "") {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(t("prettierConfigInvalid"));
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("prettierConfigInvalid"));
    }
    return parsed as Record<string, unknown>;
}

/** 一行 glob 翻成正则：`**` 跨目录，`*` 不跨目录，`?` 单个字符。 */
function globToRegExp(glob: string): RegExp {
    let source = "";
    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === "*") {
            if (glob[index + 1] === "*") {
                index++;
                if (glob[index + 1] === "/") {
                    index++;
                    source += "(?:.*/)?";
                } else {
                    source += ".*";
                }
            } else {
                source += "[^/]*";
            }
        } else if (char === "?") {
            source += "[^/]";
        } else if ("\\^$.|+()[]{}".includes(char)) {
            source += `\\${char}`;
        } else {
            source += char;
        }
    }
    return new RegExp(`^${source}$`);
}

/**
 * `.prettierignore` 的判定，只实现常用子集。
 *
 * 一行一条，`#` 开头是注释，`!` 开头取反（后写的覆盖先写的）。含 `/` 的模式按路径整段匹配，
 * 不含 `/` 的按文件名匹配，行尾 `/` 表示只匹配目录名。prettier 支持的转义与字符组这里没有实现。
 *
 * 路径是相对工作区 `data/` 的（`assets/a.js` 这种写法），不是相对 ignore 文件自己的目录：
 * 文件放在插件目录里，而它要管的文件在 `data/assets/`，按 gitignore 那套相对自身目录的规则
 * 一条也匹配不上。
 */
export function ignoredBy(text: string, apiPath: string): boolean {
    const relative = apiPath.replace(/^\/data\//, "");
    let ignored = false;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const negate = trimmed.startsWith("!");
        const body = (negate ? trimmed.slice(1) : trimmed).replace(/^\/+/, "");
        if (body === "") {
            continue;
        }
        const directory = body.endsWith("/");
        const pattern = directory ? body.slice(0, -1) : body;
        const regex = globToRegExp(pattern);
        const hit = pattern.includes("/")
            ? regex.test(relative)
            : (directory
                ? relative.split("/").slice(0, -1).some((segment) => regex.test(segment))
                : regex.test(baseName(relative)));
        if (hit) {
            ignored = !negate;
        }
    }
    return ignored;
}
