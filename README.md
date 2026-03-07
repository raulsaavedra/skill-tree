# skill-tree

`skill-tree` is a local-first learning CLI for tracking skills, quiz decks, and hands-on scenarios in one place.

It is built for people and agents that want a persistent learning system instead of ad-hoc notes and one-off flashcards.

## Features

- Hierarchical skill tree with proficiency levels from `0` to `5`
- Quiz decks with flashcard and multiple-choice review
- Hands-on scenarios linked to skills
- TUI for browsing the skill tree and reviewing cards
- Local SQLite storage with no external API dependency
- Agent-friendly CLI surface for tutoring, planning, and review workflows

## Concepts

- **Skills** represent concepts or domains you are learning.
- **Decks** hold quiz cards linked to one or more skills.
- **Scenarios** represent hands-on exercises or projects linked to skills.
- **Coverage** tracks which cards have been deliberately reviewed.

## Quick Start

Build and install locally:

```bash
./install.sh
skill-tree
```

Run a few common commands:

```bash
skill-tree context --json
skill-tree skill list --tree
skill-tree deck list
skill-tree review
```

## Data Storage

By default, `skill-tree` stores data in:

```text
$HOME/.skill-tree/skill-tree.db
```

If you already use the older `quiz` CLI, you can import its decks:

```bash
skill-tree import --from-quiz
```

## Agent Integration

This repo includes an agent skill definition at [`skills/skill-tree/SKILL.md`](./skills/skill-tree/SKILL.md).

The skill file is written for general-purpose coding or tutoring agents. It explains:

- how to load learning context at the start of a session
- how to teach using the existing decks and scenarios
- how to create or refine cards
- how to update skill levels as proficiency improves

If your agent platform supports local skill files or reusable task instructions, you can adapt that file directly.

## Development

```bash
go test ./...
go build ./...
```

The project uses:

- Go
- Cobra
- Bubble Tea
- Lip Gloss
- `modernc.org/sqlite`

## Workspace Note

Right now this repository depends on a sibling `cli-core` module via a local `replace` directive in `go.mod`.

That means the easiest way to build it today is inside the same workspace layout used in this repo. If you want to publish it as a fully standalone open-source project, the next step is to remove that local workspace dependency or publish/version `cli-core`.

## License

MIT. See [`LICENSE.md`](./LICENSE.md).
