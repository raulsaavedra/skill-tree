# skill-tree

A local-first learning CLI that tracks skills, quiz decks, hands-on scenarios, and proficiency levels. Built with Rust, using Ratatui for the interactive TUI and Clap for the CLI.

## Stack

- **Language:** Rust
- **CLI framework:** Clap (derive)
- **TUI:** Ratatui + Crossterm
- **Database:** rusqlite (bundled SQLite)
- **Local dependency:** `cli-core` (path = "../packages/cli-core") for output helpers, SQLite wrappers, and skill installer

## File Structure

```
src/main.rs         — CLI entry point, all Clap commands and TUI launchers
src/store.rs        — SQLite schema, migrations, all CRUD operations (Store struct)
src/tui.rs          — Interactive skill tree browser + review session (Ratatui)
src/tui_helpers.rs  — Level labels, bars, colors, status icons
skills/skill-tree/  — Agent skill definition (SKILL.md)
install.sh          — Builds release binary and copies to ~/.local/bin/skill-tree
```

## Commands

```bash
cargo build              # compile
cargo run -- --help      # run directly
./install.sh             # build release binary to ~/.local/bin/skill-tree
```

## Conventions

- Input validation: `validate_level()` for levels 0-5, `validate_status()` for scenario status
- Database lives at `~/.skill-tree/skill-tree.db`, opened via cli-core's `open_sqlite()`
- Decks and cards can be created via `--data`/`--file` JSON payloads or individual flags
- Card IDs support comma-separated lists and ranges (e.g., `1,3,5-10`)

## Data Model

- **Skills** -- hierarchical tree (parent_id), level 0-5, linked to decks and scenarios via junction tables
- **Decks** -- contain cards, linked to skills via `deck_skills`, track coverage
- **Cards** -- belong to a deck, support question/answer/extra/choices/correct_index/tags
- **Scenarios** -- track hands-on work, linked to skills via `scenario_skills`, support ordered plan steps, and keep scenario status progression (planned, in_progress, completed, abandoned)
