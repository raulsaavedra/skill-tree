import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

export const coveredIds = query({
  args: {
    card_ids: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.card_ids.length === 0) {
      return [];
    }

    const uniqueIDs = Array.from(new Set(args.card_ids));
    const covered = new Set<number>();
    for (const cardID of uniqueIDs) {
      const match = await ctx.db
        .query("card_coverage")
        .withIndex("by_card_id", (q) => q.eq("card_id", cardID))
        .first();
      if (match) {
        covered.add(cardID);
      }
    }

    return args.card_ids.filter((id) => covered.has(id));
  },
});

export const markCovered = mutation({
  args: {
    card_id: v.number(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("cards")
      .withIndex("by_card_id", (q) => q.eq("id", args.card_id))
      .first();
    if (!card) {
      throw new Error(`card ${args.card_id} not found`);
    }

    const existing = await ctx.db
      .query("card_coverage")
      .withIndex("by_card_id", (q) => q.eq("card_id", args.card_id))
      .first();
    if (existing) {
      return null;
    }

    await ctx.db.insert("card_coverage", {
      card_id: args.card_id,
      covered_at: new Date().toISOString(),
    });
    return null;
  },
});
