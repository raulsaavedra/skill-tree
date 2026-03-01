import { ConvexHttpClient } from "convex/browser";

function convexUrl(): string {
  const fromEnv = process.env.CONVEX_URL?.trim();
  if (!fromEnv) {
    throw new Error("Missing CONVEX_URL env var");
  }
  return fromEnv;
}

async function main() {
  const client = new ConvexHttpClient(convexUrl());
  const stats = await client.query("bootstrap:stats" as never, {} as never);
  console.log(JSON.stringify(stats, null, 2));
}

await main();
