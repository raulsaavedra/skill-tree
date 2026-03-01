import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ReviewSession } from "@/components/review/review-session";
import {
  getCoveredCardIDs,
  getDeckCards,
  getDecks,
  getSkill,
  getSkillCards,
} from "@/lib/skill-tree-api";
import type { DeckSummary } from "@/lib/skill-tree-types";

export const dynamic = "force-dynamic";

function parsePositiveInt(raw?: string): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ skillId?: string; deckId?: string; back?: string }>;
}) {
  const params = await searchParams;
  const skillID = parsePositiveInt(params.skillId);
  const deckID = parsePositiveInt(params.deckId);
  const backHref = params.back?.trim();

  if (!skillID && !deckID) {
    redirect("/");
  }

  let decksError: string | null = null;
  let decks: DeckSummary[] = [];
  let initialSession:
    | {
        label: string;
        cards: Awaited<ReturnType<typeof getSkillCards>>;
        coveredIDs: number[];
        backHref?: string;
      }
    | undefined;

  try {
    decks = await getDecks();

    if (skillID) {
      const skill = await getSkill(skillID);
      const cards = await getSkillCards(skillID, 200);
      const coveredIDs = await getCoveredCardIDs(cards.map((card) => card.id));
      initialSession = {
        label: `${skill.name} (all)`,
        cards,
        coveredIDs,
        backHref: backHref || "/",
      };
    } else if (deckID) {
      const cards = await getDeckCards(deckID, 200);
      const coveredIDs = await getCoveredCardIDs(cards.map((card) => card.id));
      const deck = decks.find((candidate) => candidate.id === deckID);
      initialSession = {
        label: deck ? deck.name : `Deck ${deckID}`,
        cards,
        coveredIDs,
        backHref: backHref || "/",
      };
    }
  } catch (error) {
    decksError =
      error instanceof Error ? error.message : "Failed to fetch review data from Go API";
  }

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Interactive Review
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {skillID ? "Skill Review" : "Quiz Session"}
            </h1>
          </div>
          <Button asChild variant="secondary">
            <Link href={backHref || "/"}>Back</Link>
          </Button>
        </header>

        {decksError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {decksError}
          </div>
        ) : (
          <ReviewSession initialDecks={decks} initialSession={initialSession} />
        )}
      </div>
    </main>
  );
}
