The input contains daily engineering summaries from a date range.

Each day is wrapped in an XML tag with its date as an attribute:

<day date="YYYY-MM-DD">
(that day's summary — markdown using a project-grouped
 "### 工作内容" list)
</day>

Multiple `<day>` blocks follow in chronological order. Use the
`date` attribute as the authoritative date for that block — do not
infer dates from headings or text inside the block. Any `# YYYY-MM-DD`
heading or `---` line you see inside a `<day>` block is part of the
day's content, not a structural divider.

**Write the synthesis in Simplified Chinese (简体中文).** Keep code
identifiers, file paths, command names, commit hashes and model names in
their original form; do not translate them. Project names stay as-is.

## Voice

Write it the way the author writes their own weekly engineering reports.
A style reference may be attached at the very top of this prompt; if it
is, imitate it. Either way these defaults apply:

- 省略主语。不要写"我""我们""本人"。直接以动词开头：
  「开发了…」「修复了…」「搭建了…」。
- 动词用"了"收尾：开发了 / 修复了 / 完成了 / 搭建了 / 增加了 / 优化了 /
  完善了 / 梳理了 / 整理了 / 实现了 / 验证了 / 删去了 / 归并了。
- 一条一件事。用逗号把动作和它的目的串起来，并列动作用"；"分隔。
- 收尾给状态或判断：「目前…」「已…」「初步…」「后续需…」「暂不…」
  「等待…」「正在排查」。
- 问题照实说，不软化：「效果较差」「根因未定位」「存在约 17% 的 QP
  回退，后续需…」。
- 日志里有数字就用数字：百分比、误差、延迟、方差、秒数。
- 不要 emoji，不要 "-" 列表符号，不要用粗体当小标题。
- 不要报告腔：禁止「旨在 / 致力于 / 赋能 / 闭环打通 / 全面提升」这类词。

## Structure

Same project-grouped shape as the daily summaries, but at range level:
merge every day of the same project into ONE group, and let each item
carry the arc — 「先…，改为…，最终…」 — instead of emitting one item per
day. Project groups use `1、` `2、`, items use `（1）` `（2）`. 组内条目之间
不空行；组与组之间空一行。

Aim for roughly 400-700 Chinese characters total — the value of a range
summary is cross-day pattern extraction, not re-summarization.

Do NOT concatenate or restate the daily summaries.
Do NOT produce a per-day timeline ("周一做了 X，周二做了 Y……").
Do NOT report a day's cache/auth/load status (e.g. "cached", "not logged in",
"no activity") as if it were the day's content. Such phrases reflect tooling
state, not engineering work — exclude them entirely. If a day has no
substantive content, just don't mention it.
Omit any group that has no substantive content.

The point of a range summary is to surface what only becomes visible by
looking across days:
- threads of work that spanned multiple days
- recurring debugging patterns or repeated tradeoffs
- outcomes that matter at the range level, not at any single day
- work that started in one day and continued, completed, or was abandoned later

When you reference a specific day, use its `date` attribute value verbatim
(`2026-06-07`), not a relative term like "周一" or "昨天".

Use the following format:

### 工作内容

1、<项目名>：
（1）<条目>：<内容，跨天的演进写在这一条里>
（2）<条目>：<内容>

2、<项目名>：
（1）<条目>：<内容>

Daily summaries follow:
