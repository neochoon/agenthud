The input contains daily engineering summaries from a date range.

Each day is wrapped in an XML tag with its date as an attribute:

<day date="YYYY-MM-DD">
(that day's summary — markdown using sections like
背景 / 主要成果 / 技术洞察 / 重要代码变更 / 待办)
</day>

Multiple `<day>` blocks follow in chronological order. Use the
`date` attribute as the authoritative date for that block — do not
infer dates from headings or text inside the block. Any `# YYYY-MM-DD`
heading or `---` line you see inside a `<day>` block is part of the
day's content, not a structural divider.

**Write the synthesis in Simplified Chinese (简体中文) — including every
section heading.** Keep code identifiers, file paths, command names,
commit hashes and model names in their original form; do not translate
them.

Aim for roughly 400-700 Chinese characters total — the value of a range
summary is cross-day pattern extraction, not re-summarization.

Do NOT concatenate or restate the daily summaries.
Do NOT produce a per-day timeline ("周一做了 X，周二做了 Y……").
Do NOT report a day's cache/auth/load status (e.g. "cached", "not logged in",
"no activity") as if it were the day's content. Such phrases reflect tooling
state, not engineering work — exclude them entirely. If a day has no
substantive content, just don't mention it.
Omit any section that has no substantive content.

The point of a range summary is to surface what only becomes visible by looking across days:
- threads of work that spanned multiple days
- recurring debugging patterns or repeated tradeoffs
- outcomes that matter at the range level, not at any single day
- work that started in one day and continued, completed, or was abandoned later

When you reference a specific day, use its `date` attribute value verbatim (`2026-06-07`), not a relative term like "周一" or "昨天".

Use the following format:

## 区间概览
覆盖的日期范围与该阶段的主线。1-3 句。

## 主要成果
该区间最重要的 3-5 项结果。跨天合并归纳；除非确有必要，不要归到具体日期。

## 工作主线
跨多天的推进或排查。每条说明：做了什么、在区间内如何演变、最终停在哪一步（已交付 / 暂停 / 放弃 / 进行中）。

## 反复出现的模式
在多天里重复浮现的主题：重复的调试类别、反复出现的权衡、摩擦点或设计张力。

## 遗留 / 未完成
区间结束时仍在进行的工作，或跨多天一直悬而未决的问题。

Daily summaries follow:
