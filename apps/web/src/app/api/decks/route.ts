import { NextResponse } from "next/server";

import { getDecks } from "@/lib/skill-tree-api";

export async function GET() {
  try {
    const decks = await getDecks();
    return NextResponse.json(decks, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch decks";
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
