# skill-tree

## Layout

- `src/cli.ts` — CLI entry point, all Commander commands
- `src/store.ts` — SQLite schema, migrations, all CRUD operations
- `src/tui-app.tsx` — interactive skill tree + review session (Ink/React)
- `src/tui-helpers.ts` — level labels, bars, colors
- `src/index.ts` — public exports
- `skills/skill-tree/SKILL.md` — agent skill definition for integrating `skill-tree` into agent workflows
- `install.sh` — Compiles binary to ~/.local/bin/skill-tree

## Build & test

```
bun install             # install deps
bun src/cli.ts --help   # run directly
./install.sh            # compile + install binary
bun test                # run tests
```

## Dependencies

- Uses local `cli-core` package (file:../packages/cli-core) for output helpers, sqlite, skills installer
- Runtime: Bun with bun:sqlite
- CLI framework: Commander
- TUI: Ink (React for terminal)

## Conventions

- Input validation: `validateLevel()` for levels 0-5, `validateStatus()` for scenario status
- Multi-statement writes use `db.transaction()`
- Database lives at `~/.skill-tree/skill-tree.db`, opened via cli-core's `openSQLite()`

## Data model

- **Skills** — hierarchical tree (parent_id), level 0-5, linked to decks and scenarios via junction tables
- **Decks** — contain cards, linked to skills via `deck_skills`
- **Cards** — belong to a deck, support question/answer/extra/choices/tags
- **Scenarios** — track hands-on work, linked to skills via `scenario_skills`, have status progression
