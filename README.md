# agenthud

Terminal dashboard for AI agent development.

![output](./output960.gif)

## Install
```bash
npx agenthud
```

## CLI

```
Usage: agenthud [command] [options]

Commands:
  init              Initialize agenthud in current directory

Options:
  -w, --watch       Watch mode (default)
  --once            Run once and exit
  -V, --version     Show version number
  -h, --help        Show this help message
```

## Features

- **Claude**: Real-time Claude Code session monitoring
- **Git**: Branch, commits, line changes
- **Tests**: Results with outdated detection
- **Project**: Package info, stack detection

## Claude Panel Icons

| Symbol | Type |
|--------|------|
| `>` | User input |
| `<` | Response |
| `~` | Edit/Write |
| `○` | Read |
| `$` | Bash |
| `*` | Glob/Grep |
| `@` | Web |
| `▶` | Task |
| `?` | Question |

## Configuration

Create `.agenthud.yaml` in your project root:

```yaml
panels:
  git:
    enabled: true
    interval: 30s
  claude:
    enabled: true
    interval: 5s
    max_activities: 20
  tests:
    enabled: true
    interval: manual
  project:
    enabled: true
    interval: 60s
```

## Keyboard

- `q` - quit
- `r` - refresh

## License

MIT
