import { NextResponse } from "next/server";

import { getCoveredCardIDs } from "@/lib/skill-tree-api";

function parseCardIDs(raw: string | null): number[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  const out: number[] = [];
  for (const item of raw.split(",")) {
    const parsed = Number(item.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Invalid card ids query");
    }
    out.push(parsed);
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cardIDs = parseCardIDs(url.searchParams.get("ids"));
    const covered = await getCoveredCardIDs(cardIDs);
    return NextResponse.json({ covered_ids: covered }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch covered ids";
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
