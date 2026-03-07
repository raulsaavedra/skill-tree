# skill-tree

`skill-tree` is a local-first learning TUI for tracking skills, quiz decks, and hands-on scenarios in one place.

It is designed for interactive learning, with agents using the stored context to tutor, quiz, and guide practice.

## Features

- Hierarchical skill tree with proficiency levels from `0` to `5`
- Quiz decks with flashcard and multiple-choice review
- Hands-on scenarios linked to skills
- TUI for browsing the skill tree and reviewing cards
- Local SQLite storage with no external API dependency
- Works well in agent-assisted tutoring, planning, and review workflows

## Concepts

- **Skills** represent concepts or domains you are learning.
- **Decks** hold quiz cards linked to one or more skills.
- **Scenarios** represent hands-on exercises or projects linked to skills.
- **Coverage** tracks which cards have been deliberately reviewed.

## Quick Start

Install the latest published version:

```bash
go install github.com/raulsaavedra/skill-tree/cmd/skill-tree@latest
skill-tree
```

For local development, build and install from the repo:

```bash
./install.sh
skill-tree
```

If you want your agent to reuse the bundled `skill-tree` instructions, install the included skill definition:

```bash
skill-tree skill install
```

For local development, `--link` is handy so agent updates track your checked-out repo:

```bash
skill-tree skill install --link
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

## Agent Integration

This repo includes an agent skill definition at [`skills/skill-tree/SKILL.md`](./skills/skill-tree/SKILL.md).

The skill file is written for general-purpose coding or tutoring agents. It explains:

- how to load learning context at the start of a session
- how to teach using the existing decks and scenarios
- how to create or refine cards
- how to update skill levels as proficiency improves

The simplest way to install that skill for an agent workflow is:

```bash
skill-tree skill install
```

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

## License

MIT. See [`LICENSE.md`](./LICENSE.md).
