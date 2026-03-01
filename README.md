# skill-tree

A unified learning CLI that tracks skills, quiz decks, and hands-on scenarios in one tool.

This repo now also includes an in-progress web port:

- `cmd/skill-tree-api` — Go HTTP API backed by the same SQLite store/domain logic.
- `apps/web` — Next.js + shadcn frontend (with a Next backend layer) that consumes the Go API.

## What it does

- **Skill tree** — hierarchical skills with proficiency levels (0-5), browsable in the web app
- **Quiz decks** — flashcard and multiple-choice review in the web app with markdown-rendered answers
- **Scenarios** — track hands-on projects linked to skills with status progression (planned → in_progress → completed)
- **Linking** — decks and scenarios link to skills, so each skill shows its associated learning material
- **Web review UI** — interactive review mode in Next.js (`/review`) with flashcard/MCQ/auto parity semantics

## Quick start

```
./install.sh
skill-tree --help
```

## Web + API (in progress)

Run Go API:

```bash
GOWORK=off go run ./cmd/skill-tree-api -addr :8080
```

Run Next.js app:

```bash
cd apps/web
cp .env.example .env.local
npm run dev
```

## Stack

- Go, Cobra (CLI)
- Go `net/http` API server (`cmd/skill-tree-api`)
- Next.js (App Router) + shadcn UI (`apps/web`)
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
