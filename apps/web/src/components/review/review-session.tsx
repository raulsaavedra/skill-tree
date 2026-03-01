"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getCoveredCardIDsClient,
  getDeckCardsClient,
  markCardCoveredClient,
} from "@/lib/skill-tree-client";
import type { Card as ReviewCard, DeckSummary } from "@/lib/skill-tree-types";

type ReviewStage = "deck_select" | "review" | "done";
type ReviewMode = "flashcard" | "mcq" | "auto";
type EffectiveMode = "flashcard" | "mcq";

interface ReviewSessionProps {
  initialDecks: DeckSummary[];
  initialSession?: {
    label: string;
    cards: ReviewCard[];
    coveredIDs: number[];
    backHref?: string;
  };
}

export function ReviewSession({ initialDecks, initialSession }: ReviewSessionProps) {
  const router = useRouter();
  const [decks, setDecks] = useState(initialDecks);
  const [stage, setStage] = useState<ReviewStage>(() => {
    if (!initialSession) {
      return "deck_select";
    }
    return initialSession.cards.length > 0 ? "review" : "done";
  });
  const [lockedSession] = useState(Boolean(initialSession));
  const [lockedBackHref] = useState(initialSession?.backHref ?? null);
  const [deckCursor, setDeckCursor] = useState(0);
  const [activeDeck, setActiveDeck] = useState<DeckSummary | null>(() => {
    if (!initialSession) {
      return null;
    }
    return {
      id: -1,
      name: initialSession.label,
      description: "",
      card_count: initialSession.cards.length,
      covered_count: initialSession.coveredIDs.length,
      updated_at: "",
    };
  });
  const [cards, setCards] = useState<ReviewCard[]>(initialSession?.cards ?? []);
  const [cardCursor, setCardCursor] = useState(0);
  const [choiceCursor, setChoiceCursor] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [mode, setMode] = useState<ReviewMode>("auto");
  const [coveredIDs, setCoveredIDs] = useState<Set<number>>(
    new Set(initialSession?.coveredIDs ?? []),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCard = cards[cardCursor] ?? null;

  const effectiveMode: EffectiveMode = useMemo(() => {
    if (!currentCard) {
      return "flashcard";
    }
    if (mode === "flashcard") {
      return "flashcard";
    }
    if (mode === "mcq") {
      return hasChoices(currentCard) ? "mcq" : "flashcard";
    }
    return hasChoices(currentCard) ? "mcq" : "flashcard";
  }, [mode, currentCard]);

  const activateDeck = useCallback(
    async (index: number) => {
      const deck = decks[index];
      if (!deck) {
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const nextCards = await getDeckCardsClient(deck.id, 200);
        let nextCovered = new Set<number>();

        if (nextCards.length > 0) {
          const coveredIDs = await getCoveredCardIDsClient(
            nextCards.map((card) => card.id),
          );
          nextCovered = new Set(coveredIDs);
        }

        setActiveDeck(deck);
        setCards(nextCards);
        setCoveredIDs(nextCovered);
        setCardCursor(0);
        setChoiceCursor(0);
        setShowAnswer(false);
        setStage(nextCards.length > 0 ? "review" : "done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown review error");
      } finally {
        setLoading(false);
      }
    },
    [decks],
  );

  const resetRevealState = useCallback(() => {
    setShowAnswer(false);
    setChoiceCursor(0);
  }, []);

  const nextCard = useCallback(() => {
    setCardCursor((value) => {
      if (cards.length === 0 || value >= cards.length - 1) {
        return value;
      }
      return value + 1;
    });
    resetRevealState();
  }, [cards.length, resetRevealState]);

  const prevCard = useCallback(() => {
    setCardCursor((value) => {
      if (value <= 0) {
        return value;
      }
      return value - 1;
    });
    resetRevealState();
  }, [resetRevealState]);

  const jumpBy = useCallback(
    (delta: number) => {
      if (cards.length === 0) {
        return;
      }
      setCardCursor((value) => {
        const next = Math.min(Math.max(value + delta, 0), cards.length - 1);
        return next;
      });
      resetRevealState();
    },
    [cards.length, resetRevealState],
  );

  const markCovered = useCallback(
    async (cardID: number) => {
      if (coveredIDs.has(cardID)) {
        return;
      }
      await markCardCoveredClient(cardID);
      setCoveredIDs((prev) => {
        const next = new Set(prev);
        next.add(cardID);
        return next;
      });
      if (activeDeck) {
        setDecks((prev) =>
          prev.map((deck) =>
            deck.id === activeDeck.id
              ? {
                  ...deck,
                  covered_count: Math.min(deck.covered_count + 1, deck.card_count),
                }
              : deck,
          ),
        );
        setActiveDeck((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            covered_count: Math.min(prev.covered_count + 1, prev.card_count),
          };
        });
      }
    },
    [activeDeck, coveredIDs],
  );

  const revealOrAdvance = useCallback(async () => {
    if (!currentCard) {
      return;
    }
    try {
      if (showAnswer) {
        await markCovered(currentCard.id);
        if (cardCursor >= cards.length - 1) {
          setStage("done");
          return;
        }
        nextCard();
        return;
      }

      setShowAnswer(true);
      if (
        effectiveMode === "mcq" &&
        currentCard.correct_index != null &&
        choiceCursor === currentCard.correct_index
      ) {
        await markCovered(currentCard.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update review state");
    }
  }, [
    cardCursor,
    cards.length,
    choiceCursor,
    currentCard,
    effectiveMode,
    markCovered,
    nextCard,
    showAnswer,
  ]);

  const backToDecks = useCallback(() => {
    if (lockedSession) {
      if (lockedBackHref) {
        router.push(lockedBackHref);
        return;
      }
      router.push("/review");
      return;
    }
    setStage("deck_select");
    setActiveDeck(null);
    setCards([]);
    setCoveredIDs(new Set());
    setCardCursor(0);
    setChoiceCursor(0);
    setShowAnswer(false);
  }, [lockedBackHref, lockedSession, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      if (stage === "deck_select") {
        if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          setDeckCursor((value) => Math.max(value - 1, 0));
          return;
        }
        if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          setDeckCursor((value) => Math.min(value + 1, decks.length - 1));
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void activateDeck(deckCursor);
        }
        return;
      }

      if (stage === "done") {
        if (event.key.toLowerCase() === "b" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          backToDecks();
        }
        return;
      }

      if (event.key === "Escape" || event.key.toLowerCase() === "q") {
        event.preventDefault();
        backToDecks();
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        backToDecks();
        return;
      }

      if (event.key === "ArrowLeft" || ["h", "p"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        prevCard();
        return;
      }
      if (event.key === "ArrowRight" || ["l", "n"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        nextCard();
        return;
      }

      if (event.key === "N") {
        event.preventDefault();
        jumpBy(10);
        return;
      }
      if (event.key === "P") {
        event.preventDefault();
        jumpBy(-10);
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setMode("flashcard");
        return;
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setMode("mcq");
        return;
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setMode("auto");
        return;
      }

      if (
        effectiveMode === "mcq" &&
        currentCard &&
        hasChoices(currentCard) &&
        (event.key === "ArrowUp" || event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setChoiceCursor((value) =>
          (value - 1 + currentCard.choices.length) % currentCard.choices.length,
        );
        return;
      }
      if (
        effectiveMode === "mcq" &&
        currentCard &&
        hasChoices(currentCard) &&
        (event.key === "ArrowDown" || event.key.toLowerCase() === "j")
      ) {
        event.preventDefault();
        setChoiceCursor((value) => (value + 1) % currentCard.choices.length);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void revealOrAdvance();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activateDeck,
    backToDecks,
    cards.length,
    currentCard,
    deckCursor,
    decks.length,
    effectiveMode,
    jumpBy,
    nextCard,
    prevCard,
    revealOrAdvance,
    stage,
  ]);

  if (stage === "deck_select") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a Deck</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decks found.</p>
          ) : (
            decks.map((deck, index) => {
              const selected = index === deckCursor;
              const pct =
                deck.card_count > 0
                  ? Math.round((deck.covered_count / deck.card_count) * 100)
                  : 0;

              return (
                <button
                  key={deck.id}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    setDeckCursor(index);
                    void activateDeck(index);
                  }}
                  type="button"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-medium">{deck.name}</p>
                    <Badge variant={selected ? "default" : "secondary"}>
                      {deck.covered_count}/{deck.card_count}
                    </Badge>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </button>
              );
            })
          )}
          <p className="text-xs text-muted-foreground">
            Keyboard: j/k to select deck, enter to start.
          </p>
          {loading ? <p className="text-xs text-muted-foreground">Loading deck...</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (stage === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Review Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {cards.length === 0 ? "No cards in selected deck." : "Finished review session."}
          </p>
          <Button onClick={backToDecks} variant="secondary">
            {lockedSession ? "Back" : "Back to Decks"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const modeLabel =
    mode === "flashcard" ? "Flashcard" : mode === "mcq" ? "MCQ" : "Auto";
  const answer = currentCard ? answerText(currentCard) : "";
  const isCovered = currentCard ? coveredIDs.has(currentCard.id) : false;

  return (
    <Card className="gap-4">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Review</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={isCovered ? "default" : "secondary"}>
              {cardCursor + 1}/{cards.length}
            </Badge>
            <Badge variant="outline">{modeLabel}</Badge>
            {activeDeck ? <Badge variant="secondary">{activeDeck.name}</Badge> : null}
          </div>
        </div>
        <PaginationDots cards={cards} current={cardCursor} covered={coveredIDs} />
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <p className="mb-2 text-base font-semibold sm:text-lg">{currentCard?.question}</p>

        {effectiveMode === "mcq" && currentCard && hasChoices(currentCard) ? (
          <div className="mt-2 mb-5 space-y-2 sm:mt-3 sm:mb-6">
            {currentCard.choices.map((choice, index) => {
              const selected = index === choiceCursor;
              const isCorrect = currentCard.correct_index === index;
              const stateClass = showAnswer
                ? isCorrect
                  ? "border-emerald-500/60 bg-emerald-500/15"
                  : selected
                    ? "border-rose-500/60 bg-rose-500/15"
                    : "border-border bg-muted/20"
                : selected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted/40";

              return (
                <button
                  key={`${currentCard.id}-${index}`}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${stateClass}`}
                  onClick={() => setChoiceCursor(index)}
                  type="button"
                >
                  {choice}
                </button>
              );
            })}
          </div>
        ) : null}

        {showAnswer ? (
          <div className="mb-3 space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 sm:mb-4">
            <p className="text-sm font-semibold text-emerald-300">Answer</p>
            <MarkdownBlock content={answer} />
            {currentCard?.extra?.trim() ? (
              <div className="text-muted-foreground">
                <MarkdownBlock content={currentCard.extra} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void revealOrAdvance()}>
            {showAnswer ? "Next Card" : "Reveal"}
          </Button>
          <Button onClick={prevCard} variant="secondary">
            Prev
          </Button>
          <Button onClick={nextCard} variant="secondary">
            Next
          </Button>
          <Button onClick={backToDecks} variant="ghost">
            {lockedSession ? "Back" : "Back to Decks"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setMode("flashcard")}
            size="sm"
            variant={mode === "flashcard" ? "default" : "outline"}
          >
            Flashcard (f)
          </Button>
          <Button
            onClick={() => setMode("mcq")}
            size="sm"
            variant={mode === "mcq" ? "default" : "outline"}
          >
            MCQ (m)
          </Button>
          <Button
            onClick={() => setMode("auto")}
            size="sm"
            variant={mode === "auto" ? "default" : "outline"}
          >
            Auto (a)
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Keys: enter/space reveal-next, j/k choices, n/p next-prev, N/P jump 10, f/m/a mode, b
          back, q quit to decks.
        </p>
      </CardContent>
    </Card>
  );
}

function hasChoices(card: ReviewCard): boolean {
  return (
    Array.isArray(card.choices) &&
    card.choices.length > 0 &&
    card.correct_index !== null &&
    card.correct_index !== undefined
  );
}

function answerText(card: ReviewCard): string {
  if (card.correct_index == null) {
    return card.answer;
  }
  if (card.correct_index >= 0 && card.correct_index < card.choices.length) {
    return card.choices[card.correct_index];
  }
  return card.answer;
}

function PaginationDots({
  cards,
  current,
  covered,
}: {
  cards: ReviewCard[];
  current: number;
  covered: Set<number>;
}) {
  if (cards.length === 0) {
    return null;
  }

  const maxDots = 40;
  let start = 0;
  let end = cards.length;
  if (cards.length > maxDots) {
    const half = Math.floor(maxDots / 2);
    start = Math.max(0, current - half);
    end = start + maxDots;
    if (end > cards.length) {
      end = cards.length;
      start = Math.max(0, end - maxDots);
    }
  }

  return (
    <div className="flex items-center gap-1 text-sm leading-none">
      {start > 0 ? <span className="text-muted-foreground">...</span> : null}
      {cards.slice(start, end).map((card, index) => {
        const absolute = start + index;
        const coveredState = covered.has(card.id);
        const className =
          absolute === current
            ? coveredState
              ? "text-emerald-400"
              : "text-foreground"
            : coveredState
              ? "text-emerald-700"
              : "text-muted-foreground";
        return (
          <span className={className} key={card.id}>
            •
          </span>
        );
      })}
      {end < cards.length ? <span className="text-muted-foreground">...</span> : null}
    </div>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-6">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          code: ({ children }) => (
            <code className="rounded bg-black/30 px-1 py-0.5 text-amber-200">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-black/35 p-2 text-xs">{children}</pre>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
