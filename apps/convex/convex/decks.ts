import { v } from "convex/values";

import { query } from "./_generated/server";
import {
  buildDeckSummaries,
  loadCards,
  loadCoverage,
  loadDecks,
  toReviewCard,
} from "./model";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const [decks, cards, coverage] = await Promise.all([
      loadDecks(ctx),
      loadCards(ctx),
      loadCoverage(ctx),
    ]);
    const summaries = buildDeckSummaries(decks, cards, coverage);
    return Array.from(summaries.values()).sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) {
        return byName;
      }
      return left.id - right.id;
    });
  },
});

export const cards = query({
  args: {
    deck_id: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_deck_id", (q) => q.eq("deck_id", args.deck_id))
      .collect();

    return cards
      .sort((left, right) => left.id - right.id)
      .slice(0, limit)
      .map(toReviewCard);
  },
});
