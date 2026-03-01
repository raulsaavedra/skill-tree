# skill-tree Convex backend

## Scripts

```bash
bun run dev            # start Convex dev
bun run codegen        # regenerate convex/_generated bindings
bun run import:sqlite  # migrate ~/.skill-tree/skill-tree.db into Convex
bun run stats          # print table counts from Convex
```

## Environment

Create `apps/convex/.env.local` with:

- `CONVEX_DEPLOYMENT`
- `CONVEX_URL`
- `CONVEX_SITE_URL`
