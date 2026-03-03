# skill-tree

A unified learning CLI that tracks skills, quiz decks, and hands-on scenarios in one tool.

## What it does

- **Skill tree** — hierarchical skills with proficiency levels (0-5), navigate and review from an interactive TUI
- **Quiz decks** — flashcard and multiple-choice review with markdown-rendered answers, mode switching, and pagination
- **Scenarios** — track hands-on projects linked to skills with status progression (planned → in_progress → completed)
- **Linking** — decks and scenarios link to skills, so each skill shows its associated learning material

## Quick start

```
./install.sh
skill-tree
```

## Stack

- Go, Cobra (CLI), BubbleTea (TUI), Lipgloss (styling)
- SQLite via modernc.org/sqlite (pure Go, no CGO)
- [cli-core](../packages/cli-core) for shared utilities (DB, output, skill install)

## Data

All data lives in `~/.skill-tree/skill-tree.db`. Import existing quiz decks with:

```
skill-tree import --from-quiz
```

## Claude integration

This CLI is designed to work with Claude Code as a learning companion. Install the Claude skill to teach Claude how to use it:

```
skill-tree skill install --link --force
```

The skill definition lives in `skills/skill-tree/SKILL.md` and instructs Claude on session startup, deck creation, tutoring, and skill level updates.
