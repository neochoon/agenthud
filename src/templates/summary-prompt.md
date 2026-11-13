The following is an activity log from a single day of AI coding-agent
sessions (Claude Code, Codex, Kiro, opencode, DeepSeek Harness), possibly
spanning multiple projects.

Each entry: `[HH:MM] <icon> <label>: <detail>`. Icons:
  ○ Read           ~ Edit/Write       $ Bash
  * Glob/Grep      @ WebFetch         » Sub-agent task
  < Response       > User message     … Thinking
  ◆ Git commit

**Write the summary in Simplified Chinese (简体中文).** Keep code
identifiers, file paths, command names, commit hashes and model names in
their original form; do not translate them. Project names stay as-is.

## Voice

Write it the way the author writes their own weekly engineering reports.
A style reference may be attached at the very top of this prompt; if it
is, imitate it. Either way these defaults apply:

- 省略主语。不要写"我""我们""本人"。直接以动词开头：
  「开发了…」「修复了…」「搭建了…」。
- 动词用"了"收尾：开发了 / 修复了 / 完成了 / 搭建了 / 增加了 / 优化了 /
  完善了 / 梳理了 / 整理了 / 实现了 / 验证了 / 删去了 / 归并了 /
  迁入了 / 重写了 / 补充了。
- 一条一件事。用逗号把动作和它的目的串起来，并列动作用"；"分隔——
  一条常常是一整句长句，而不是几个碎片。
- 收尾给状态或判断：「目前…」「已…」「初步…」「后续需…」「暂不…」
  「等待…」「正在排查」。
- 问题照实说，不软化：「效果较差」「根因未定位」「存在约 17% 的 QP
  回退，后续需…」。
- 日志里有数字就用数字：「平均误差在 5cm 内」「延迟从 0.073ms 增大为
  0.178ms」、百分比、方差、秒数。
- 不要 emoji，不要 "-" 列表符号，不要用粗体当小标题。
- 不要报告腔：禁止「旨在 / 致力于 / 赋能 / 闭环打通 / 全面提升」这类词。

## Structure

按项目分组。项目组用 `1、` `2、` 编号，后接项目名和全角冒号；组内条目用
`（1）` `（2）` 编号；条目下再有分点时用 `1）` `2）` 或 `① ②`。

推荐条目形态是「这次做的事的名字：具体内容」，例如
「RTK定位融合：新增串口RTK读取，将RTK数据转发至控制进程；…」。

组内条目之间不空行；组与组之间空一行。

Target ~300-500 Chinese characters. Favor synthesis over completeness.

Focus on:
- meaningful accomplishments
- debugging discoveries
- architectural decisions
- implementation progress
- important tradeoffs or realizations
- unfinished work and explicit next steps

Do NOT:
- mechanically summarize every edit, response, or commit
- list every modified file (cite paths only for important changes)
- invent follow-ups not present in the log (no "考虑重构 X")
- include placeholders like "无" or "N/A" — omit empty groups entirely

If the day was light (few entries, no meaningful work), output a single
short paragraph instead of the numbered structure. Do not pad.

Format (drop any group with no substance):

### 工作内容

1、<项目名>：
（1）<条目>：<内容>
（2）<条目>：<内容>

2、<项目名>：
（1）<条目>：<内容>

After reading the log below, write the summary.

Activity log:
