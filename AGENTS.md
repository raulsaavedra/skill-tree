# skill-tree

## Layout

- `apps/cli/src/main.ts` — Bun CLI entry point (calls Convex directly)
- `apps/convex/convex/schema.ts` — Convex schema definition
- `apps/convex/convex/*.ts` — Convex queries/mutations used by web + CLI
- `apps/convex/scripts/import-from-sqlite.ts` — SQLite -> Convex migration script
- `apps/web/src/app/page.tsx` — web dashboard and skill tree
- `apps/web/src/components/skill-tree/skill-tree-explorer.tsx` — interactive skill tree UI
- `skills/skill-tree/SKILL.md` — Claude skill definition (installed to ~/.agents/skills/)
- `install.sh` — compiles Bun CLI binary to ~/.local/bin/skill-tree

## Build & test

```
./install.sh                            # compile + install Bun CLI
cd apps/convex && bun run codegen       # regenerate Convex _generated types
cd apps/convex && bun run import:sqlite # migrate SQLite data into Convex
cd apps/convex && bun run stats         # verify Convex record counts
cd apps/web && npm run lint             # lint web app
cd apps/web && npm run build            # compile check web app
cd apps/cli && bunx tsc --noEmit        # type-check Bun CLI
cd apps/convex && bunx tsc --noEmit     # type-check Convex functions/scripts
```

## Conventions

- Always use single-line commands (no backslash continuations) for CLI operations.
- Keep Convex response payloads aligned with `apps/web/src/lib/skill-tree-types.ts`.
- `CONVEX_URL` is required by `apps/web` server routes and the Bun CLI.

## Data model

- **Skills** — hierarchical tree (`parent_id`), level 0-5, linked to decks and scenarios via junction tables
- **Decks** — contain cards, linked to skills via `deck_skills`
- **Cards** — belong to a deck, support question/answer/extra/choices/tags
- **Scenarios** — track hands-on work, linked to skills via `scenario_skills`, with status progression
- **Coverage** — card review completion tracked in `card_coverage`
