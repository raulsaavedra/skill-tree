import { NextResponse } from "next/server";

import { getContext } from "@/lib/skill-tree-api";

export async function GET() {
  try {
    const context = await getContext();
    return NextResponse.json(context, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch context";
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
