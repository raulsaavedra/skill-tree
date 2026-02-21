# skill-builder

## Overview
Unified learning CLI: skill tree + quiz decks + hands-on scenarios in one tool.
Cobra + BubbleTea + SQLite, using cli-core for shared utilities.

## Layout
- `cmd/skill-builder/main.go`: CLI entry + all Cobra commands
- `internal/store/store.go`: SQLite schema + all CRUD
- `internal/tui/tree.go`: Skill tree TUI
- `internal/tui/review.go`: Card review TUI (from quiz)
- `internal/tui/markdown.go`: Shared markdown rendering
- `skills/skill-builder/SKILL.md`: Claude skill definition

## Build & Install
```
./install.sh
```

## Data
- SQLite DB at `~/.skill-builder/skill-builder.db`
- Import quiz data: `skill-builder import --from-quiz`

## Commands
- Always use single-line commands (no backslash continuations)
