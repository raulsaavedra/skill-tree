# skill-tree

A learning app for tracking skills, quiz decks, and hands-on scenarios with a Convex backend, Next.js web UI, and Bun CLI.

Main apps:

- `apps/convex` — Convex schema + queries/mutations
- `apps/web` — Next.js + shadcn UI (server routes call Convex)
- `apps/cli` — Bun CLI that calls Convex directly

## What it does

- **Skill tree** — hierarchical skills with proficiency levels (0-5), browsable in the web app
- **Quiz decks** — flashcard and multiple-choice review in the web app with markdown-rendered answers
- **Scenarios** — track hands-on projects linked to skills with status progression (planned → in_progress → completed)
- **Linking** — decks and scenarios link to skills, so each skill shows its associated learning material
- **Web review UI** — interactive review mode in Next.js (`/review`) with flashcard/MCQ/auto parity semantics

## Quick start

```
cd apps/convex
bun run dev
```

In a second terminal:

```bash
cd apps/web
npm run dev
```

In a third terminal (optional CLI):

```bash
./install.sh
skill-tree help
```

## Migrate existing SQLite data to Convex

If you already have `~/.skill-tree/skill-tree.db`, import it:

```bash
cd apps/convex
bun run import:sqlite
```

## Stack

- Convex
- Next.js (App Router) + shadcn UI (`apps/web`)
- Bun CLI (`apps/cli`)
- SQLite migration script (one-time import into Convex)

## Data

Runtime data lives in Convex.  
If you already have local SQLite data at `~/.skill-tree/skill-tree.db`, import it with:

```bash
cd apps/convex
bun run import:sqlite
```
