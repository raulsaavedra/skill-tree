import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const skillValidator = v.object({
  id: v.number(),
  parent_id: v.optional(v.number()),
  name: v.string(),
  description: v.string(),
  level: v.number(),
  created_at: v.string(),
  updated_at: v.string(),
});

const deckValidator = v.object({
  id: v.number(),
  name: v.string(),
  description: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

const cardValidator = v.object({
  id: v.number(),
  deck_id: v.number(),
  question: v.string(),
  answer: v.string(),
  extra: v.string(),
  choices: v.array(v.string()),
  correct_index: v.optional(v.number()),
  tags: v.array(v.string()),
});

const scenarioValidator = v.object({
  id: v.number(),
  name: v.string(),
  description: v.string(),
  repo_path: v.string(),
  status: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
  completed_at: v.optional(v.string()),
});

const deckSkillValidator = v.object({
  deck_id: v.number(),
  skill_id: v.number(),
});

const scenarioSkillValidator = v.object({
  scenario_id: v.number(),
  skill_id: v.number(),
});

const cardCoverageValidator = v.object({
  card_id: v.number(),
  covered_at: v.optional(v.string()),
});

const replaceSnapshotArgs = v.object({
  skills: v.array(skillValidator),
  decks: v.array(deckValidator),
  cards: v.array(cardValidator),
  scenarios: v.array(scenarioValidator),
  deck_skills: v.array(deckSkillValidator),
  scenario_skills: v.array(scenarioSkillValidator),
  card_coverage: v.array(cardCoverageValidator),
});

const clearOrder = [
  "card_coverage",
  "scenario_skills",
  "deck_skills",
  "cards",
  "scenarios",
  "decks",
  "skills",
] as const;

export const replaceSnapshot = mutation({
  args: replaceSnapshotArgs,
  handler: async (ctx, args) => {
    for (const table of clearOrder) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }

    for (const skill of args.skills) {
      await ctx.db.insert("skills", skill);
    }
    for (const deck of args.decks) {
      await ctx.db.insert("decks", deck);
    }
    for (const card of args.cards) {
      await ctx.db.insert("cards", card);
    }
    for (const scenario of args.scenarios) {
      await ctx.db.insert("scenarios", scenario);
    }
    for (const link of args.deck_skills) {
      await ctx.db.insert("deck_skills", link);
    }
    for (const link of args.scenario_skills) {
      await ctx.db.insert("scenario_skills", link);
    }
    for (const coverage of args.card_coverage) {
      await ctx.db.insert("card_coverage", coverage);
    }

    return {
      skills: args.skills.length,
      decks: args.decks.length,
      cards: args.cards.length,
      scenarios: args.scenarios.length,
      deck_skills: args.deck_skills.length,
      scenario_skills: args.scenario_skills.length,
      card_coverage: args.card_coverage.length,
    };
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const [
      skills,
      decks,
      cards,
      scenarios,
      deckSkills,
      scenarioSkills,
      coverage,
    ] = await Promise.all([
      ctx.db.query("skills").collect(),
      ctx.db.query("decks").collect(),
      ctx.db.query("cards").collect(),
      ctx.db.query("scenarios").collect(),
      ctx.db.query("deck_skills").collect(),
      ctx.db.query("scenario_skills").collect(),
      ctx.db.query("card_coverage").collect(),
    ]);

    return {
      skills: skills.length,
      decks: decks.length,
      cards: cards.length,
      scenarios: scenarios.length,
      deck_skills: deckSkills.length,
      scenario_skills: scenarioSkills.length,
      card_coverage: coverage.length,
    };
  },
});
