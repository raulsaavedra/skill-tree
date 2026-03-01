import "server-only";

import { ConvexHttpClient } from "convex/browser";

import type {
  Card,
  ContextResponse,
  DeckSummary,
  SkillNode,
} from "@/lib/skill-tree-types";

function convexUrl(): string {
  const raw =
    process.env.CONVEX_URL?.trim() ?? process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (raw && raw.length > 0) {
    return raw;
  }
  throw new Error("Missing CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL)");
}

function convexClient(): ConvexHttpClient {
  return new ConvexHttpClient(convexUrl());
}

export async function getContext(): Promise<ContextResponse> {
  return queryFunction<ContextResponse>("context:get", {});
}

export async function getDecks(): Promise<DeckSummary[]> {
  return queryFunction<DeckSummary[]>("decks:list", {});
}

export async function getDeckCards(deckID: number, limit = 200): Promise<Card[]> {
  return queryFunction<Card[]>("decks:cards", {
    deck_id: deckID,
    limit,
  });
}

export async function getSkill(skillID: number): Promise<SkillNode> {
  return queryFunction<SkillNode>("skills:get", {
    skill_id: skillID,
  });
}

export async function getSkillCards(skillID: number, limit = 200): Promise<Card[]> {
  return queryFunction<Card[]>("skills:cards", {
    skill_id: skillID,
    limit,
  });
}

export async function getCoveredCardIDs(cardIDs: number[]): Promise<number[]> {
  if (cardIDs.length === 0) {
    return [];
  }
  return queryFunction<number[]>("coverage:coveredIds", {
    card_ids: cardIDs,
  });
}

export async function markCardCovered(cardID: number): Promise<void> {
  await mutationFunction("coverage:markCovered", {
    card_id: cardID,
  });
}

async function queryFunction<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const client = convexClient();
  try {
    return (await client.query(functionName as never, args as never)) as T;
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
  const client = convexClient();
  try {
    await client.mutation(functionName as never, args as never);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Convex mutation error";
    throw new Error(`Convex mutation ${functionName} failed: ${message}`);
  }
}
