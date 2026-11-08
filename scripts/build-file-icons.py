#!/usr/bin/env python3
"""生成 src/file-icons.ts：把 VS Code 默认 Seti 文件图标主题的字形转成 SVG symbol。

Seti 主题本身是字体（seti.woff）+ 映射表（vs-seti-icon-theme.json），
思源的图标接口只认 <symbol>，所以这里把每个被映射引用的字形转成路径。

输入文件从 microsoft/vscode 取，两者都是 MIT 许可（见生成文件头部的说明）：

    https://raw.githubusercontent.com/microsoft/vscode/<commit>/extensions/theme-seti/icons/seti.woff
    https://raw.githubusercontent.com/microsoft/vscode/<commit>/extensions/theme-seti/icons/vs-seti-icon-theme.json

依赖 fontTools（`pip install fonttools`）。这个脚本只在刷新图标时手动跑，
不参与 npm run build。
"""

import argparse
import json
import os
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# 字形在 16x16 里占多大。Seti 是按 13px 字号设计的，直接按字体度量缩放到 16px
# 只有 6 到 8 像素高，在思源的页签和菜单里太小；这里按每个字形自己的外框
# 缩放到 14x14 再居中，图形不变，只是把留白去掉。
TARGET_SIZE = 14


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", required=True, help="seti.woff 的路径")
    parser.add_argument("--theme", required=True, help="vs-seti-icon-theme.json 的路径")
    parser.add_argument("--out", required=True, help="输出的 TypeScript 文件")
    parser.add_argument("--commit", default="main", help="microsoft/vscode 的提交，用于来源说明")
    return parser.parse_args()


def symbol_id(definition):
    """_c-sharp -> iconEditorFileCSharp。"""
    parts = [part for part in definition.lstrip("_").replace("-", "_").split("_") if part]
    return "iconEditorFile" + "".join(part[:1].upper() + part[1:] for part in parts)


def number(value):
    """保留三位小数，去掉尾随的零。"""
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def glyph_path(glyph_set, cmap, character):
    glyph_name = cmap[ord(chr(int(character[1:], 16)))]
    bounds = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(bounds)
    if bounds.bounds is None:
        return ""
    x_min, y_min, x_max, y_max = bounds.bounds
    width = x_max - x_min
    height = y_max - y_min
    scale = TARGET_SIZE / max(width, height)
    # 字体坐标 y 向上，SVG 向下；翻转后把外框居中到 16x16 里
    transform = Transform(
        scale,
        0,
        0,
        -scale,
        (16 - width * scale) / 2 - x_min * scale,
        (16 - height * scale) / 2 + y_max * scale,
    )
    pen = SVGPathPen(glyph_set, ntos=number)
    glyph_set[glyph_name].draw(TransformPen(pen, transform))
    return pen.getCommands()


def quoted(value):
    return json.dumps(value, ensure_ascii=False)


def emit_record(name, entries):
    lines = [f"export const {name}: Record<string, string> = {{"]
    for key in sorted(entries):
        lines.append(f"    {quoted(key)}: {quoted(entries[key])},")
    lines.append("};")
    return "\n".join(lines)


def main():
    args = parse_args()
    theme = json.load(open(args.theme, encoding="utf-8"))
    font = TTFont(args.font)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()

    # 主题里只有 fileExtensions / fileNames / languageIds 三处会引用图标；
    # file / folder 等目录图标用不到，跳过。
    referenced = (
        set(theme["fileExtensions"].values())
        | set(theme["fileNames"].values())
        | set(theme["languageIds"].values())
    )

    # 同一字形常被多个定义共用，颜色不同（_c / _c_1 / _c_2 分别是 C 源文件、
    # 头文件和 Objective-C）。按「字形 + fontColor」归并，同色同形才共用一个 symbol。
    variants = {}
    for definition in sorted(referenced):
        info = theme["iconDefinitions"][definition]
        variants.setdefault((info["fontCharacter"], info.get("fontColor", "")), definition)

    def icon_id(definition):
        info = theme["iconDefinitions"][definition]
        key = (info["fontCharacter"], info.get("fontColor", ""))
        return symbol_id(variants[key])

    symbols = []
    for key in sorted(variants):
        definition = variants[key]
        character, color = key
        path = glyph_path(glyph_set, cmap, character)
        if not path.strip():
            sys.exit(f"{definition}: 字形 {character} 没有轮廓")
        # _todo 没有 fontColor，退回 currentColor
        fill = color or "currentColor"
        symbols.append(
            f'<symbol id="{symbol_id(definition)}" viewBox="0 0 16 16">'
            f'<path fill="{fill}" d="{path}"/></symbol>'
        )

    by_name = {
        name.lower(): icon_id(icon)
        for name, icon in theme["fileNames"].items()
    }
    by_extension = {
        extension.lower(): icon_id(icon)
        for extension, icon in theme["fileExtensions"].items()
    }
    by_language = {
        language: icon_id(icon)
        for language, icon in theme["languageIds"].items()
    }

    header = f"""/**
 * 文件类型图标：VS Code 默认的 Seti 文件图标主题（`vs-seti`）。
 *
 * 字形来自 extensions/theme-seti/icons/seti.woff，映射表来自同目录的
 * vs-seti-icon-theme.json，两者都是 MIT 许可：
 * - VS Code，Copyright (c) Microsoft Corporation
 * - Seti UI，Copyright (c) 2014 Jesse Weed
 * 来源：https://github.com/microsoft/vscode/tree/{args.commit}/extensions/theme-seti
 *
 * 由 scripts/build-file-icons.py 生成，不要手改。每个字形按自身外框缩放到
 * 14x14 再居中；颜色取主题里的 fontColor，没有颜色的定义（_todo）用 currentColor。
 * 只生成默认（深色）配色，JSON 里的 light 变体只差一点，没有单独生成。
 */
"""
    body = "\n".join(symbols)
    output = (
        header
        + "\n"
        + f"export const FILE_ICONS = `{body}`;\n\n"
        + emit_record("FILE_ICON_BY_NAME", by_name)
        + "\n\n"
        + emit_record("FILE_ICON_BY_EXTENSION", by_extension)
        + "\n\n"
        + emit_record("FILE_ICON_BY_LANGUAGE", by_language)
        + "\n"
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(output)
    print(f"{args.out}: {len(symbols)} symbols, {len(by_name)} names, "
          f"{len(by_extension)} extensions, {len(by_language)} languages")


if __name__ == "__main__":
    main()
