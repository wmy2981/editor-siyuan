/**
 * 未保存改动的关闭确认。
 *
 * 页签的关闭控件（close-guard.ts）、移动端对话框的关闭按钮（mobile.ts）、浮层与切换文件
 * （popup.ts、view.ts）共用这一条：有未保存改动且设置里要求确认时先问，用户点「保存」
 * 并保存成功、或点「不保存」之后才 proceed。
 *
 * 单独成一个模块是为了不被 view.ts 反向依赖：close-guard.ts 与 view.ts 都要用它，
 * 而 close-guard.ts 自己又依赖 view.ts。
 */
import {openConfirmDialog} from "../dialogs/dialog";
import {baseName} from "../core/util";
import type {Settings} from "../core/config";
import type {T} from "../i18n";

/** 关闭确认要问的对象：页签视图、浮层视图与移动端对话框视图都满足它。 */
export interface IClosable {
    readonly link: string;
    isDirty(): boolean;
    save(): Promise<boolean>;
    discard(): void;
}

export function confirmClose(view: IClosable, t: T, settings: () => Settings, proceed: () => void): void {
    if (!view.isDirty() || !settings().confirmOnClose) {
        proceed();
        return;
    }
    openConfirmDialog({
        title: t("closeTitle"),
        // 链接既可能是 assets/xxx.txt，也可能是 /data/<box>/xxx.sy：只取文件名，别按前缀切
        text: t("closeBody", {file: baseName(view.link)}),
        cancelLabel: t("cancel"),
        onCancel: () => {
            // 取消：关闭动作已经被拦下，什么都不做即可
        },
        actions: [
            {
                label: t("closeDiscard"),
                danger: true,
                onClick: () => {
                    view.discard();
                    proceed();
                },
            },
            {
                label: t("save"),
                primary: true,
                onClick: () => {
                    void view.save().then((ok) => {
                        if (ok) {
                            proceed();
                        }
                    });
                },
            },
        ],
    });
}
