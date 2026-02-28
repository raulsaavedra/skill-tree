import { NextResponse } from "next/server";

import { getDeckCards } from "@/lib/skill-tree-api";

function parseDeckID(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid deck id");
  }
  return parsed;
}

function parseLimit(raw: string | null): number {
  if (!raw) {
    return 200;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid limit");
  }
  return parsed;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deckId: string }> },
) {
  try {
    const resolved = await params;
    const deckID = parseDeckID(resolved.deckId);
    const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
    const cards = await getDeckCards(deckID, limit);
    return NextResponse.json(cards, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch deck cards";
    return NextResponse.json(
      {
        error: {
          message,
          status: 502,
        },
      },
      { status: 502 },
    );
  }
}
