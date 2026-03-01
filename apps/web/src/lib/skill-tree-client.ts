import { ConvexHttpClient } from "convex/browser";

import type { Card } from "@/lib/skill-tree-types";

let cachedClient: ConvexHttpClient | null = null;

function clientConvexUrl(): string {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (raw && raw.length > 0) {
    return raw;
  }
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
}

function convexClient(): ConvexHttpClient {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new ConvexHttpClient(clientConvexUrl());
  return cachedClient;
}

async function queryFunction<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    return (await convexClient().query(functionName as never, args as never)) as T;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Convex query error";
    throw new Error(`Convex query ${functionName} failed: ${message}`);
  }
}

async function mutationFunction(
  functionName: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    await convexClient().mutation(functionName as never, args as never);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Convex mutation error";
    throw new Error(`Convex mutation ${functionName} failed: ${message}`);
  }
}

export async function getDeckCardsClient(
  deckID: number,
  limit = 200,
): Promise<Card[]> {
  return queryFunction<Card[]>("decks:cards", {
    deck_id: deckID,
    limit,
  });
}

export async function getCoveredCardIDsClient(
  cardIDs: number[],
): Promise<number[]> {
  if (cardIDs.length === 0) {
    return [];
  }
  return queryFunction<number[]>("coverage:coveredIds", {
    card_ids: cardIDs,
  });
}

export async function markCardCoveredClient(cardID: number): Promise<void> {
  await mutationFunction("coverage:markCovered", {
    card_id: cardID,
  });
}
