# skill-tree

A local-first learning CLI that tracks skills, quiz decks, hands-on scenarios, and proficiency levels. Built with TypeScript on Bun, using Ink for the interactive TUI and Commander for the CLI.

## Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **CLI framework:** Commander
- **TUI:** Ink (React for terminal)
- **Database:** bun:sqlite (via cli-core's `openSQLite()`)
- **Local dependency:** `cli-core` (file:../packages/cli-core) for output helpers, SQLite wrappers, and skill installer

## File Structure

```
src/cli.ts          — CLI entry point, all Commander commands and TUI launchers
src/store.ts        — SQLite schema, migrations, all CRUD operations (Store class)
src/tui-app.tsx     — Interactive skill tree browser + review session (Ink/React)
src/tui-helpers.ts  — Level labels, bars, colors, status icons
src/index.ts        — Public exports (Store, types, helpers)
skills/skill-tree/  — Agent skill definition (SKILL.md)
install.sh          — Compiles binary to ~/.local/bin/skill-tree via `bun build --compile`
```

## Commands

```bash
bun install              # install deps
bun src/cli.ts --help    # run directly
bun test                 # run tests
bun run typecheck        # type-check without emitting
./install.sh             # compile standalone binary to ~/.local/bin/skill-tree
```

## Conventions

- Input validation: `validateLevel()` for levels 0-5, `validateStatus()` for scenario status
- Multi-statement writes use `db.transaction()`
- Database lives at `~/.skill-tree/skill-tree.db`, opened via cli-core's `openSQLite()`
- Decks and cards can be created via `--data`/`--file` JSON payloads or individual flags
- Card IDs support comma-separated lists and ranges (e.g., `1,3,5-10`)

## Data Model

- **Skills** -- hierarchical tree (parent_id), level 0-5, linked to decks and scenarios via junction tables
- **Decks** -- contain cards, linked to skills via `deck_skills`, track coverage
- **Cards** -- belong to a deck, support question/answer/extra/choices/correct_index/tags
- **Scenarios** -- track hands-on work, linked to skills via `scenario_skills`, status progression (planned, in_progress, completed, abandoned)
