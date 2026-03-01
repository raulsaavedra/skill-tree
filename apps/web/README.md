# skill-tree web

Next.js + shadcn frontend for `skill-tree`, using Convex as the backend.

## Getting Started

1. Start Convex from repo root:

```bash
cd apps/convex
bun run dev
```

2. Set `CONVEX_URL` for the Next.js server:

```bash
cd apps/web
cp .env.example .env.local
```

3. Run the Next.js dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Architecture

- Convex functions: `apps/convex/convex/*.ts`
- Server-side data access: `src/lib/skill-tree-api.ts` (used by server components)
- Client-side review access: `src/lib/skill-tree-client.ts` (direct Convex queries/mutations)
- Next UI:
  - `src/app/page.tsx` dashboard
  - `src/app/review/page.tsx` interactive quiz review
  - `src/app/skills/[skillId]/page.tsx` skill detail (decks + scenarios + skill review)

## Scripts

```bash
npm run dev
npm run lint
npm run build
```
