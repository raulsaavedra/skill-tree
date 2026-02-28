import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ReviewSession } from "@/components/review/review-session";
import { getDecks } from "@/lib/skill-tree-api";
import type { DeckSummary } from "@/lib/skill-tree-types";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  let decksError: string | null = null;
  let decks: DeckSummary[] = [];

  try {
    decks = await getDecks();
  } catch (error) {
    decksError =
      error instanceof Error ? error.message : "Failed to fetch decks from Go API";
  }

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Interactive Review
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Quiz Session</h1>
          </div>
          <Button asChild variant="secondary">
            <Link href="/">Back to Dashboard</Link>
          </Button>
        </header>

        {decksError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {decksError}
          </div>
        ) : (
          <ReviewSession initialDecks={decks} />
        )}
      </div>
    </main>
  );
}
