import { homedir } from "node:os";
import { join } from "node:path";

import { ConvexHttpClient } from "convex/browser";

import { Database } from "bun:sqlite";

const choiceSeparator = "|␟|";

interface SkillRow {
  id: number;
  parent_id: number | null;
  name: string;
  description: string | null;
  level: number;
  created_at: string | null;
  updated_at: string | null;
}

interface DeckRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface CardRow {
  id: number;
  deck_id: number;
  question: string;
  answer: string;
  extra: string | null;
  choices: string | null;
  correct_index: number | null;
}

interface ScenarioRow {
  id: number;
  name: string;
  description: string | null;
  repo_path: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

interface CardTagRow {
  card_id: number;
  tag: string;
}

interface DeckSkillRow {
  deck_id: number;
  skill_id: number;
}

interface ScenarioSkillRow {
  scenario_id: number;
  skill_id: number;
}

interface CardCoverageRow {
  card_id: number;
  covered_at: string | null;
}

function parseDBPath(): string {
  const args = process.argv.slice(2);
  const dbFlagIndex = args.findIndex((arg) => arg === "--db");
  if (dbFlagIndex === -1) {
    return join(homedir(), ".skill-tree", "skill-tree.db");
  }
  const pathArg = args[dbFlagIndex + 1];
  if (!pathArg || pathArg.startsWith("--")) {
    throw new Error("Missing value for --db");
  }
  return pathArg;
}

function convexUrl(): string {
  const fromEnv = process.env.CONVEX_URL?.trim();
  if (!fromEnv) {
    throw new Error("Missing CONVEX_URL env var");
  }
  return fromEnv;
}

function toText(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

function decodeChoices(raw: string | null): string[] {
  if (!raw || raw.trim() === "") {
    return [];
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // Fall back to separator format.
    }
  }

  return raw.split(choiceSeparator).map((item) => item.trim());
}

function loadSnapshot(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const skills = db
      .query(
        `
          SELECT id, parent_id, name, COALESCE(description, '') AS description,
                 level, created_at, updated_at
          FROM skills
          ORDER BY id
        `,
      )
      .all() as SkillRow[];

    const decks = db
      .query(
        `
          SELECT id, name, COALESCE(description, '') AS description,
                 created_at, updated_at
          FROM decks
          ORDER BY id
        `,
      )
      .all() as DeckRow[];

    const cards = db
      .query(
        `
          SELECT id, deck_id, question, answer, COALESCE(extra, '') AS extra,
                 choices, correct_index
          FROM cards
          ORDER BY id
        `,
      )
      .all() as CardRow[];

    const scenarios = db
      .query(
        `
          SELECT id, name, COALESCE(description, '') AS description,
                 COALESCE(repo_path, '') AS repo_path, status,
                 created_at, updated_at, completed_at
          FROM scenarios
          ORDER BY id
        `,
      )
      .all() as ScenarioRow[];

    const cardTags = db
      .query(
        `
          SELECT card_id, tag
          FROM card_tags
          ORDER BY card_id, tag
        `,
      )
      .all() as CardTagRow[];

    const deckSkills = db
      .query(
        `
          SELECT deck_id, skill_id
          FROM deck_skills
          ORDER BY skill_id, deck_id
        `,
      )
      .all() as DeckSkillRow[];

    const scenarioSkills = db
      .query(
        `
          SELECT scenario_id, skill_id
          FROM scenario_skills
          ORDER BY skill_id, scenario_id
        `,
      )
      .all() as ScenarioSkillRow[];

    const cardCoverage = db
      .query(
        `
          SELECT card_id, covered_at
          FROM card_coverage
          ORDER BY card_id
        `,
      )
      .all() as CardCoverageRow[];

    const tagsByCard = new Map<number, string[]>();
    for (const row of cardTags) {
      const current = tagsByCard.get(row.card_id) ?? [];
      current.push(row.tag);
      tagsByCard.set(row.card_id, current);
    }

    return {
      skills: skills.map((skill) => ({
        id: skill.id,
        parent_id: skill.parent_id ?? undefined,
        name: skill.name,
        description: toText(skill.description),
        level: skill.level,
        created_at: toText(skill.created_at),
        updated_at: toText(skill.updated_at),
      })),
      decks: decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        description: toText(deck.description),
        created_at: toText(deck.created_at),
        updated_at: toText(deck.updated_at),
      })),
      cards: cards.map((card) => ({
        id: card.id,
        deck_id: card.deck_id,
        question: card.question,
        answer: card.answer,
        extra: toText(card.extra),
        choices: decodeChoices(card.choices),
        correct_index: card.correct_index ?? undefined,
        tags: tagsByCard.get(card.id) ?? [],
      })),
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        description: toText(scenario.description),
        repo_path: toText(scenario.repo_path),
        status: scenario.status,
        created_at: toText(scenario.created_at),
        updated_at: toText(scenario.updated_at),
        completed_at: scenario.completed_at ?? undefined,
      })),
      deck_skills: deckSkills.map((link) => ({
        deck_id: link.deck_id,
        skill_id: link.skill_id,
      })),
      scenario_skills: scenarioSkills.map((link) => ({
        scenario_id: link.scenario_id,
        skill_id: link.skill_id,
      })),
      card_coverage: cardCoverage.map((coverage) => ({
        card_id: coverage.card_id,
        covered_at: coverage.covered_at ?? undefined,
      })),
    };
  } finally {
    db.close();
  }
}

async function main() {
  const dbPath = parseDBPath();
  const snapshot = loadSnapshot(dbPath);
  const client = new ConvexHttpClient(convexUrl());

  const result = await client.mutation(
    "bootstrap:replaceSnapshot" as never,
    snapshot as never,
  );

  console.log("Imported snapshot into Convex");
  console.log(`Database: ${dbPath}`);
  console.log(JSON.stringify(result, null, 2));
}

await main();
