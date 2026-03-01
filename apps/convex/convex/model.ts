import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

type SkillDoc = Doc<"skills">;
type DeckDoc = Doc<"decks">;
type CardDoc = Doc<"cards">;
type ScenarioDoc = Doc<"scenarios">;
type DeckSkillDoc = Doc<"deck_skills">;
type ScenarioSkillDoc = Doc<"scenario_skills">;
type CardCoverageDoc = Doc<"card_coverage">;

export interface DeckSummary {
  id: number;
  name: string;
  description?: string;
  card_count: number;
  covered_count: number;
  updated_at: string;
}

export interface ScenarioSummary {
  id: number;
  name: string;
  description?: string;
  repo_path?: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface SkillNode {
  id: number;
  parent_id?: number;
  name: string;
  description?: string;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  children?: SkillNode[];
  decks?: DeckSummary[];
  scenarios?: ScenarioSummary[];
  created_at: string;
  updated_at: string;
}

export interface ContextResponse {
  skills: SkillNode[];
  active_scenarios: ScenarioSummary[];
}

export interface ReviewCard {
  id: number;
  deck_id: number;
  question: string;
  answer: string;
  extra: string;
  choices: string[];
  correct_index: number | null;
  tags: string[];
}

const statusOrder = new Map<string, number>([
  ["planned", 2],
  ["in_progress", 1],
  ["completed", 0],
  ["abandoned", -1],
]);

function compareByNameThenID<
  T extends { name: string; id: number },
>(left: T, right: T): number {
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) {
    return byName;
  }
  return left.id - right.id;
}

function compactSkillNode(node: SkillNode): SkillNode {
  const next: SkillNode = {
    id: node.id,
    name: node.name,
    level: node.level,
    created_at: node.created_at,
    updated_at: node.updated_at,
  };

  if (node.parent_id !== undefined) {
    next.parent_id = node.parent_id;
  }
  if (node.description && node.description.trim() !== "") {
    next.description = node.description;
  }
  if (node.decks && node.decks.length > 0) {
    next.decks = node.decks;
  }
  if (node.scenarios && node.scenarios.length > 0) {
    next.scenarios = node.scenarios;
  }
  if (node.children && node.children.length > 0) {
    next.children = node.children
      .slice()
      .sort(compareByNameThenID)
      .map(compactSkillNode);
  }

  return next;
}

function toSkillNode(skill: SkillDoc): SkillNode {
  const node: SkillNode = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    level: clampSkillLevel(skill.level),
    children: [],
    decks: [],
    scenarios: [],
    created_at: skill.created_at,
    updated_at: skill.updated_at,
  };
  if (skill.parent_id !== undefined) {
    node.parent_id = skill.parent_id;
  }
  return node;
}

function clampSkillLevel(raw: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (raw < 0) {
    return 0;
  }
  if (raw > 5) {
    return 5;
  }
  return raw as 0 | 1 | 2 | 3 | 4 | 5;
}

export function toReviewCard(card: CardDoc): ReviewCard {
  return {
    id: card.id,
    deck_id: card.deck_id,
    question: card.question,
    answer: card.answer,
    extra: card.extra,
    choices: card.choices,
    correct_index: card.correct_index ?? null,
    tags: card.tags,
  };
}

export function toScenarioSummary(scenario: ScenarioDoc): ScenarioSummary {
  const next: ScenarioSummary = {
    id: scenario.id,
    name: scenario.name,
    status: scenario.status,
    created_at: scenario.created_at,
    updated_at: scenario.updated_at,
  };
  if (scenario.description && scenario.description.trim() !== "") {
    next.description = scenario.description;
  }
  if (scenario.repo_path && scenario.repo_path.trim() !== "") {
    next.repo_path = scenario.repo_path;
  }
  if (scenario.completed_at && scenario.completed_at.trim() !== "") {
    next.completed_at = scenario.completed_at;
  }
  return next;
}

export async function loadSkills(ctx: QueryCtx): Promise<SkillDoc[]> {
  const docs = await ctx.db.query("skills").collect();
  return docs.sort(compareByNameThenID);
}

export async function loadDecks(ctx: QueryCtx): Promise<DeckDoc[]> {
  const docs = await ctx.db.query("decks").collect();
  return docs.sort(compareByNameThenID);
}

export async function loadCards(ctx: QueryCtx): Promise<CardDoc[]> {
  const docs = await ctx.db.query("cards").collect();
  return docs.sort((left, right) => left.id - right.id);
}

export async function loadScenarios(ctx: QueryCtx): Promise<ScenarioDoc[]> {
  const docs = await ctx.db.query("scenarios").collect();
  return docs.sort(compareByNameThenID);
}

export async function loadDeckSkillLinks(ctx: QueryCtx): Promise<DeckSkillDoc[]> {
  return ctx.db.query("deck_skills").collect();
}

export async function loadScenarioSkillLinks(
  ctx: QueryCtx,
): Promise<ScenarioSkillDoc[]> {
  return ctx.db.query("scenario_skills").collect();
}

export async function loadCoverage(ctx: QueryCtx): Promise<CardCoverageDoc[]> {
  return ctx.db.query("card_coverage").collect();
}

export function buildDeckSummaries(
  decks: DeckDoc[],
  cards: CardDoc[],
  coverage: CardCoverageDoc[],
): Map<number, DeckSummary> {
  const totalByDeck = new Map<number, number>();
  const coveredByDeck = new Map<number, number>();
  const coveredCardIDs = new Set<number>(coverage.map((item) => item.card_id));

  for (const card of cards) {
    totalByDeck.set(card.deck_id, (totalByDeck.get(card.deck_id) ?? 0) + 1);
    if (coveredCardIDs.has(card.id)) {
      coveredByDeck.set(
        card.deck_id,
        (coveredByDeck.get(card.deck_id) ?? 0) + 1,
      );
    }
  }

  const byID = new Map<number, DeckSummary>();
  for (const deck of decks) {
    byID.set(deck.id, {
      id: deck.id,
      name: deck.name,
      description: deck.description,
      card_count: totalByDeck.get(deck.id) ?? 0,
      covered_count: coveredByDeck.get(deck.id) ?? 0,
      updated_at: deck.updated_at,
    });
  }

  return byID;
}

export function buildDeckLinksBySkill(
  deckSkillLinks: DeckSkillDoc[],
  deckSummariesByID: Map<number, DeckSummary>,
): Map<number, DeckSummary[]> {
  const bySkillID = new Map<number, DeckSummary[]>();
  for (const link of deckSkillLinks) {
    const deck = deckSummariesByID.get(link.deck_id);
    if (!deck) {
      continue;
    }
    const current = bySkillID.get(link.skill_id) ?? [];
    current.push(deck);
    bySkillID.set(link.skill_id, current);
  }

  for (const [skillID, decks] of bySkillID.entries()) {
    bySkillID.set(
      skillID,
      decks.slice().sort(compareByNameThenID),
    );
  }

  return bySkillID;
}

export function buildScenarioLinksBySkill(
  scenarioSkillLinks: ScenarioSkillDoc[],
  scenarioByID: Map<number, ScenarioSummary>,
): Map<number, ScenarioSummary[]> {
  const bySkillID = new Map<number, ScenarioSummary[]>();
  for (const link of scenarioSkillLinks) {
    const scenario = scenarioByID.get(link.scenario_id);
    if (!scenario) {
      continue;
    }
    const current = bySkillID.get(link.skill_id) ?? [];
    current.push(scenario);
    bySkillID.set(link.skill_id, current);
  }

  for (const [skillID, scenarios] of bySkillID.entries()) {
    bySkillID.set(
      skillID,
      scenarios.slice().sort(compareByNameThenID),
    );
  }

  return bySkillID;
}

export function buildScenarioSummaryMap(
  scenarios: ScenarioDoc[],
): Map<number, ScenarioSummary> {
  const byID = new Map<number, ScenarioSummary>();
  for (const scenario of scenarios) {
    byID.set(scenario.id, toScenarioSummary(scenario));
  }
  return byID;
}

export function buildSkillTree(skills: SkillDoc[]): SkillNode[] {
  const sorted = skills.slice().sort(compareByNameThenID);
  const nodeByID = new Map<number, SkillNode>();
  for (const skill of sorted) {
    nodeByID.set(skill.id, toSkillNode(skill));
  }

  const roots: SkillNode[] = [];
  for (const skill of sorted) {
    const node = nodeByID.get(skill.id);
    if (!node) {
      continue;
    }
    if (skill.parent_id !== undefined && nodeByID.has(skill.parent_id)) {
      const parent = nodeByID.get(skill.parent_id);
      parent?.children?.push(node);
      continue;
    }
    roots.push(node);
  }

  return roots.map(compactSkillNode);
}

function attachLinksToNode(
  node: SkillNode,
  deckLinksBySkill: Map<number, DeckSummary[]>,
  scenarioLinksBySkill: Map<number, ScenarioSummary[]>,
): void {
  const linkedDecks = deckLinksBySkill.get(node.id) ?? [];
  const linkedScenarios = scenarioLinksBySkill.get(node.id) ?? [];
  node.decks = linkedDecks;
  node.scenarios = linkedScenarios;

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      attachLinksToNode(child, deckLinksBySkill, scenarioLinksBySkill);
    }
  }
}

function cloneSkillNode(node: SkillNode): SkillNode {
  const next: SkillNode = {
    id: node.id,
    name: node.name,
    level: node.level,
    created_at: node.created_at,
    updated_at: node.updated_at,
  };
  if (node.parent_id !== undefined) {
    next.parent_id = node.parent_id;
  }
  if (node.description !== undefined) {
    next.description = node.description;
  }
  if (node.decks !== undefined) {
    next.decks = node.decks.map((deck) => ({ ...deck }));
  }
  if (node.scenarios !== undefined) {
    next.scenarios = node.scenarios.map((scenario) => ({ ...scenario }));
  }
  if (node.children !== undefined) {
    next.children = node.children.map(cloneSkillNode);
  }
  return next;
}

export function attachLinksToTree(
  roots: SkillNode[],
  deckLinksBySkill: Map<number, DeckSummary[]>,
  scenarioLinksBySkill: Map<number, ScenarioSummary[]>,
): SkillNode[] {
  const withLinks = roots.map(cloneSkillNode);
  for (const node of withLinks) {
    attachLinksToNode(node, deckLinksBySkill, scenarioLinksBySkill);
  }
  return withLinks.map(compactSkillNode);
}

export function buildActiveScenarios(
  scenarios: ScenarioDoc[],
): ScenarioSummary[] {
  return scenarios
    .filter(
      (scenario) =>
        scenario.status === "planned" || scenario.status === "in_progress",
    )
    .sort((left, right) => {
      const leftOrder = statusOrder.get(left.status) ?? 0;
      const rightOrder = statusOrder.get(right.status) ?? 0;
      if (leftOrder !== rightOrder) {
        return rightOrder - leftOrder;
      }
      return left.name.localeCompare(right.name);
    })
    .map(toScenarioSummary);
}

export function buildSkillWithImmediateChildren(
  skills: SkillDoc[],
  skillID: number,
  deckLinksBySkill: Map<number, DeckSummary[]>,
  scenarioLinksBySkill: Map<number, ScenarioSummary[]>,
): SkillNode {
  const skill = skills.find((item) => item.id === skillID);
  if (!skill) {
    throw new Error(`skill ${skillID} not found`);
  }

  const parentNode = toSkillNode(skill);
  parentNode.decks = deckLinksBySkill.get(skill.id) ?? [];
  parentNode.scenarios = scenarioLinksBySkill.get(skill.id) ?? [];

  const childSkills = skills
    .filter((item) => item.parent_id === skillID)
    .sort(compareByNameThenID);
  parentNode.children = childSkills.map((child) => {
    const childNode = toSkillNode(child);
    childNode.decks = deckLinksBySkill.get(child.id) ?? [];
    childNode.scenarios = scenarioLinksBySkill.get(child.id) ?? [];
    return compactSkillNode(childNode);
  });

  return compactSkillNode(parentNode);
}

export function collectSkillAndDescendants(
  skills: SkillDoc[],
  rootSkillID: number,
): Set<number> {
  const childIDsByParent = new Map<number, number[]>();
  for (const skill of skills) {
    if (skill.parent_id === undefined) {
      continue;
    }
    const siblings = childIDsByParent.get(skill.parent_id) ?? [];
    siblings.push(skill.id);
    childIDsByParent.set(skill.parent_id, siblings);
  }

  const selected = new Set<number>();
  const queue: number[] = [rootSkillID];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || selected.has(current)) {
      continue;
    }
    selected.add(current);
    const children = childIDsByParent.get(current) ?? [];
    queue.push(...children);
  }

  return selected;
}
