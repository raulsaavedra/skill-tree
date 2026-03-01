# skill-tree

## Layout

- `cmd/skill-tree/main.go` — CLI entry point, all Cobra commands
- `cmd/skill-tree-api/main.go` — Go HTTP API entry point
- `internal/store/store.go` — SQLite schema, migrations, all CRUD operations
- `internal/store/store_test.go` — Store tests (run with `go test ./...`)
- `internal/httpapi/handler.go` — REST API handlers used by the web app
- `apps/web/src/app/page.tsx` — web dashboard and skill tree
- `apps/web/src/components/skill-tree/skill-tree-explorer.tsx` — interactive skill tree UI
- `skills/skill-tree/SKILL.md` — Claude skill definition (installed to ~/.agents/skills/)
- `install.sh` — Builds binary to ~/.local/bin/skill-tree

## Build & test

```
./install.sh          # build + install
go test ./...         # run store tests
go build ./...        # compile check
```

## Dependencies

- Uses `cli-core` from `../packages/cli-core` (local replace in go.mod)
- Part of the Go workspace at `~/src/go.work`

## Conventions

- Always use single-line commands (no backslash continuations) for CLI operations
- Input validation: `store.ValidateLevel()` for levels 0-5, `store.ValidateStatus()` for scenario status
- Multi-statement writes use transactions (`db.Begin()` / `tx.Commit()` / `defer tx.Rollback()`)
- Database lives at `~/.skill-tree/skill-tree.db`, opened via `sqliteutil.OpenSQLite()`

## Data model

- **Skills** — hierarchical tree (parent_id), level 0-5, linked to decks and scenarios via junction tables
- **Decks** — contain cards, linked to skills via `deck_skills`
- **Cards** — belong to a deck, support question/answer/extra/choices/tags
- **Scenarios** — track hands-on work, linked to skills via `scenario_skills`, have status progression
