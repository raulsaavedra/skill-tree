import { v } from "convex/values";

import { query } from "./_generated/server";
import {
  attachLinksToTree,
  buildDeckLinksBySkill,
  buildDeckSummaries,
  buildScenarioLinksBySkill,
  buildScenarioSummaryMap,
  buildSkillTree,
  buildSkillWithImmediateChildren,
  collectSkillAndDescendants,
  loadCards,
  loadCoverage,
  loadDecks,
  loadDeckSkillLinks,
  loadScenarios,
  loadScenarioSkillLinks,
  loadSkills,
  toReviewCard,
} from "./model";

export const tree = query({
  args: {},
  handler: async (ctx) => {
    const [skills, decks, cards, scenarios, deckSkillLinks, scenarioSkillLinks, coverage] =
      await Promise.all([
        loadSkills(ctx),
        loadDecks(ctx),
        loadCards(ctx),
        loadScenarios(ctx),
        loadDeckSkillLinks(ctx),
        loadScenarioSkillLinks(ctx),
        loadCoverage(ctx),
      ]);

    const tree = buildSkillTree(skills);
    const deckSummaries = buildDeckSummaries(decks, cards, coverage);
    const scenarioSummaries = buildScenarioSummaryMap(scenarios);
    const deckLinksBySkill = buildDeckLinksBySkill(deckSkillLinks, deckSummaries);
    const scenarioLinksBySkill = buildScenarioLinksBySkill(
      scenarioSkillLinks,
      scenarioSummaries,
    );

    return attachLinksToTree(tree, deckLinksBySkill, scenarioLinksBySkill);
  },
});

export const get = query({
  args: {
    skill_id: v.number(),
  },
  handler: async (ctx, args) => {
    const [skills, decks, cards, scenarios, deckSkillLinks, scenarioSkillLinks, coverage] =
      await Promise.all([
        loadSkills(ctx),
        loadDecks(ctx),
        loadCards(ctx),
        loadScenarios(ctx),
        loadDeckSkillLinks(ctx),
        loadScenarioSkillLinks(ctx),
        loadCoverage(ctx),
      ]);

    const deckSummaries = buildDeckSummaries(decks, cards, coverage);
    const scenarioSummaries = buildScenarioSummaryMap(scenarios);
    const deckLinksBySkill = buildDeckLinksBySkill(deckSkillLinks, deckSummaries);
    const scenarioLinksBySkill = buildScenarioLinksBySkill(
      scenarioSkillLinks,
      scenarioSummaries,
    );

    return buildSkillWithImmediateChildren(
      skills,
      args.skill_id,
      deckLinksBySkill,
      scenarioLinksBySkill,
    );
  },
});

export const cards = query({
  args: {
    skill_id: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }

    const [skills, deckSkillLinks, cards] = await Promise.all([
      loadSkills(ctx),
      loadDeckSkillLinks(ctx),
      loadCards(ctx),
    ]);

    const relevantSkillIDs = collectSkillAndDescendants(skills, args.skill_id);
    const deckIDs = new Set<number>();
    for (const link of deckSkillLinks) {
      if (relevantSkillIDs.has(link.skill_id)) {
        deckIDs.add(link.deck_id);
      }
    }
    if (deckIDs.size === 0) {
      return [];
    }

    return cards
      .filter((card) => deckIDs.has(card.deck_id))
      .sort((left, right) => left.id - right.id)
      .slice(0, limit)
      .map(toReviewCard);
  },
});
