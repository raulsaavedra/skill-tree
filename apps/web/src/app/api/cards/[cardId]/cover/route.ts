import { NextResponse } from "next/server";

import { markCardCovered } from "@/lib/skill-tree-api";

function parseCardID(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid card id");
  }
  return parsed;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  try {
    const resolved = await params;
    const cardID = parseCardID(resolved.cardId);
    await markCardCovered(cardID);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mark card covered";
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
