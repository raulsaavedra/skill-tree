# skill-tree web

Next.js + shadcn frontend for `skill-tree`, using a Go backend API as the source of truth.

## Getting Started

1. Start the Go API from repo root:

```bash
GOWORK=off go run ./cmd/skill-tree-api -addr :8080
```

2. Configure API base URL:

```bash
cp .env.example .env.local
```

3. Run the Next.js dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Architecture

- Go API: `cmd/skill-tree-api` (`/healthz`, `/v1/context`, `/v1/skills/tree`, `/v1/decks`, `/v1/scenarios`)
- Next backend routes:
  - `src/app/api/context/route.ts`
  - `src/app/api/decks/route.ts`
  - `src/app/api/decks/[deckId]/cards/route.ts`
  - `src/app/api/cards/covered/route.ts`
  - `src/app/api/cards/[cardId]/cover/route.ts`
- Next UI:
  - `src/app/page.tsx` dashboard
  - `src/app/review/page.tsx` interactive quiz review

## Scripts

```bash
npm run dev
npm run lint
npm run build
```
