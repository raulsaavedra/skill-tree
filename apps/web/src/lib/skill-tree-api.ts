import "server-only";

import type {
  Card,
  ContextResponse,
  DeckSummary,
  SkillNode,
} from "@/lib/skill-tree-types";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8080";

function apiBaseUrl(): string {
  const raw = process.env.SKILL_TREE_API_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_API_BASE_URL;
}

export async function getContext(): Promise<ContextResponse> {
  return getJSON<ContextResponse>("/v1/context");
}

export async function getDecks(): Promise<DeckSummary[]> {
  return getJSON<DeckSummary[]>("/v1/decks");
}

export async function getDeckCards(deckID: number, limit = 200): Promise<Card[]> {
  return getJSON<Card[]>(`/v1/decks/${deckID}/cards?limit=${limit}`);
}

export async function getSkill(skillID: number): Promise<SkillNode> {
  return getJSON<SkillNode>(`/v1/skills/${skillID}`);
}

export async function getSkillCards(skillID: number, limit = 200): Promise<Card[]> {
  return getJSON<Card[]>(`/v1/skills/${skillID}/cards?limit=${limit}`);
}

export async function getCoveredCardIDs(cardIDs: number[]): Promise<number[]> {
  if (cardIDs.length === 0) {
    return [];
  }
  const data = await getJSON<{ covered_ids: number[] }>(
    `/v1/cards/covered?ids=${cardIDs.join(",")}`,
  );
  return data.covered_ids ?? [];
}

export async function markCardCovered(cardID: number): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/v1/cards/${cardID}/cover`, {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Go API ${response.status}: ${body || response.statusText}`);
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Go API ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}
