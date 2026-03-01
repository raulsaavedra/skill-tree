import { query } from "./_generated/server";
import {
  attachLinksToTree,
  buildActiveScenarios,
  buildDeckLinksBySkill,
  buildDeckSummaries,
  buildScenarioLinksBySkill,
  buildScenarioSummaryMap,
  buildSkillTree,
  loadCards,
  loadCoverage,
  loadDecks,
  loadDeckSkillLinks,
  loadScenarios,
  loadScenarioSkillLinks,
  loadSkills,
} from "./model";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const [
      skills,
      decks,
      cards,
      scenarios,
      deckSkillLinks,
      scenarioSkillLinks,
      coverage,
    ] = await Promise.all([
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

    const tree = buildSkillTree(skills);
    const linkedTree = attachLinksToTree(tree, deckLinksBySkill, scenarioLinksBySkill);
    const activeScenarios = buildActiveScenarios(scenarios);

    return {
      skills: linkedTree,
      active_scenarios: activeScenarios,
    };
  },
});
