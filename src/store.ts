import { Database } from "bun:sqlite";
import { openSQLite, dbPath } from "cli-core";
import { existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// --- Types ---

export interface Skill {
  id: number;
  parent_id?: number | null;
  name: string;
  description: string;
  level: number;
  children: Skill[];
  decks: Deck[];
  scenarios: Scenario[];
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: number;
  name: string;
  description: string;
  repo_path: string;
  status: string;
  skills: Skill[];
  created_at: string;
  updated_at: string;
  completed_at: string;
}

export interface SkillUpdate {
  name?: string;
  description?: string;
  level?: number;
}

export interface ScenarioUpdate {
  name?: string;
  description?: string;
  repo_path?: string;
  status?: string;
}

export interface Context {
  skills: Skill[];
  active_scenarios: Scenario[];
}

export interface Deck {
  id: number;
  name: string;
  description: string;
  card_count: number;
  covered_count: number;
  updated_at: string;
}

export interface Card {
  id: number;
  deck_id: number;
  question: string;
  answer: string;
  extra: string;
  choices: string[];
  correct_index: number | null;
  tags: string[];
}

export interface CardUpdate {
  question?: string;
  answer?: string;
  extra?: string;
  choices?: string[];
  correct_index?: number;
  tags?: string[];
}

// --- Validation ---

export function validateLevel(level: number): void {
  if (level < 0 || level > 5) {
    throw new Error(`level must be 0-5, got ${level}`);
  }
}

export function clampLevel(level: number): number {
  if (level < 0) return 0;
  if (level > 5) return 5;
  return level;
}

const VALID_STATUSES = new Set([
  "planned",
  "in_progress",
  "completed",
  "abandoned",
]);

export function validateStatus(status: string): void {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(
      `status must be one of: planned, in_progress, completed, abandoned; got "${status}"`,
    );
  }
}

// --- Choice encoding ---

const CHOICE_SEPARATOR = "|␟|";

function encodeChoices(choices: string[]): string | null {
  if (choices.length === 0) return null;
  return choices.join(CHOICE_SEPARATOR);
}

function decodeChoices(raw: string | null): string[] {
  if (!raw || raw === "") return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return raw.split(CHOICE_SEPARATOR);
}

// --- Migration ---

function migrateOldDataDir(): void {
  const home = homedir();
  const oldDir = join(home, ".skill-builder");
  const newDir = join(home, ".skill-tree");
  try {
    if (statSync(newDir)) return;
  } catch {
    // new dir doesn't exist, continue
  }
  try {
    statSync(oldDir);
  } catch {
    return; // old dir doesn't exist either
  }
  const oldDB = join(oldDir, "skill-builder.db");
  const newDB = join(oldDir, "skill-tree.db");
  if (existsSync(oldDB)) {
    try {
      renameSync(oldDB, newDB);
    } catch {
      // ignore
    }
  }
  try {
    renameSync(oldDir, newDir);
  } catch {
    // ignore
  }
}

function migrate(db: Database): void {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS skills (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id   INTEGER REFERENCES skills(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      level       INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS decks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS cards (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id       INTEGER NOT NULL,
      question      TEXT NOT NULL,
      answer        TEXT NOT NULL,
      extra         TEXT,
      choices       TEXT,
      correct_index INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS card_tags (
      card_id INTEGER NOT NULL,
      tag     TEXT NOT NULL,
      PRIMARY KEY(card_id, tag),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS scenarios (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      description  TEXT,
      repo_path    TEXT,
      status       TEXT NOT NULL DEFAULT 'planned',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS scenario_skills (
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      PRIMARY KEY (scenario_id, skill_id)
    )`,
    `CREATE TABLE IF NOT EXISTS deck_skills (
      deck_id  INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      PRIMARY KEY (deck_id, skill_id)
    )`,
    `CREATE TABLE IF NOT EXISTS card_coverage (
      card_id    INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      covered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TRIGGER IF NOT EXISTS cards_updated_at AFTER UPDATE ON cards
    BEGIN
      UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS cards_inserted_at AFTER INSERT ON cards
    BEGIN
      UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS skills_updated_at AFTER UPDATE ON skills
    FOR EACH ROW BEGIN
      UPDATE skills SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS scenarios_updated_at AFTER UPDATE ON scenarios
    FOR EACH ROW BEGIN
      UPDATE scenarios SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END`,
  ];
  for (const stmt of stmts) {
    db.exec(stmt);
  }
}

// --- Store ---

export class Store {
  db: Database;
  path: string;

  constructor(db: Database, path: string) {
    this.db = db;
    this.path = path;
  }

  static open(): Store {
    migrateOldDataDir();
    const { db, path } = openSQLite({
      appName: "skill-tree",
      filename: "skill-tree.db",
      pragmas: ["foreign_keys = ON"],
      migrate,
    });
    return new Store(db, path);
  }

  close(): void {
    this.db.close();
  }

  // --- Skill CRUD ---

  createSkill(
    name: string,
    description: string,
    parentId: number | null,
    level: number,
  ): number {
    const stmt = this.db.prepare(
      `INSERT INTO skills(name, description, parent_id, level) VALUES(?, ?, ?, ?)`,
    );
    const result = stmt.run(
      name,
      description || null,
      parentId,
      level,
    ) as { lastInsertRowid: number };
    return Number(result.lastInsertRowid);
  }

  listSkills(parentId: number | null): Skill[] {
    const query =
      parentId === null
        ? `SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
           FROM skills WHERE parent_id IS NULL ORDER BY name ASC`
        : `SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
           FROM skills WHERE parent_id = ? ORDER BY name ASC`;
    const rows =
      parentId === null
        ? this.db.prepare(query).all()
        : this.db.prepare(query).all(parentId);
    return (rows as any[]).map((r) => ({
      ...r,
      parent_id: r.parent_id ?? null,
      children: [],
      decks: [],
      scenarios: [],
    }));
  }

  getSkill(id: number): Skill {
    const row = this.db
      .prepare(
        `SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
         FROM skills WHERE id = ?`,
      )
      .get(id) as any;
    if (!row) throw new Error(`skill ${id} not found`);
    const skill: Skill = {
      ...row,
      parent_id: row.parent_id ?? null,
      children: [],
      decks: [],
      scenarios: [],
    };
    this.loadSkillLinks(skill);
    skill.children = this.getChildSkills(id);
    return skill;
  }

  private getChildSkills(parentId: number): Skill[] {
    const rows = this.db
      .prepare(
        `SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
         FROM skills WHERE parent_id = ? ORDER BY name ASC`,
      )
      .all(parentId) as any[];
    const children: Skill[] = rows.map((r) => ({
      ...r,
      parent_id: r.parent_id ?? null,
      children: [],
      decks: [],
      scenarios: [],
    }));
    for (const child of children) {
      this.loadSkillLinks(child);
    }
    return children;
  }

  private loadSkillLinks(skill: Skill): void {
    // Linked decks
    const drows = this.db
      .prepare(
        `SELECT d.id, d.name, COALESCE(d.description,'') as description, COUNT(c.id) as card_count, COUNT(cc.card_id) as covered_count, d.updated_at
         FROM deck_skills ds
         JOIN decks d ON d.id = ds.deck_id
         LEFT JOIN cards c ON c.deck_id = d.id
         LEFT JOIN card_coverage cc ON cc.card_id = c.id
         WHERE ds.skill_id = ?
         GROUP BY d.id
         ORDER BY d.name`,
      )
      .all(skill.id) as Deck[];
    skill.decks = drows;

    // Linked scenarios
    const srows = this.db
      .prepare(
        `SELECT sc.id, sc.name, COALESCE(sc.description,'') as description, COALESCE(sc.repo_path,'') as repo_path,
                sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'') as completed_at
         FROM scenario_skills ss
         JOIN scenarios sc ON sc.id = ss.scenario_id
         WHERE ss.skill_id = ?
         ORDER BY sc.name`,
      )
      .all(skill.id) as any[];
    skill.scenarios = srows.map((r) => ({ ...r, skills: [] }));
  }

  updateSkill(id: number, update: SkillUpdate): void {
    const sets: string[] = [];
    const args: any[] = [];
    if (update.name !== undefined) {
      sets.push("name = ?");
      args.push(update.name);
    }
    if (update.description !== undefined) {
      sets.push("description = ?");
      args.push(update.description === "" ? null : update.description);
    }
    if (update.level !== undefined) {
      sets.push("level = ?");
      args.push(update.level);
    }
    if (sets.length === 0) return;
    args.push(id);
    const query = `UPDATE skills SET ${sets.join(", ")} WHERE id = ?`;
    const result = this.db.prepare(query).run(...args) as { changes: number };
    if (result.changes === 0) throw new Error(`skill ${id} not found`);
  }

  deleteSkill(id: number): void {
    const result = this.db.prepare(`DELETE FROM skills WHERE id = ?`).run(id) as {
      changes: number;
    };
    if (result.changes === 0) throw new Error(`skill ${id} not found`);
  }

  skillTree(): Skill[] {
    const rows = this.db
      .prepare(
        `SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
         FROM skills ORDER BY name ASC`,
      )
      .all() as any[];
    const all: Skill[] = rows.map((r) => ({
      ...r,
      parent_id: r.parent_id ?? null,
      children: [],
      decks: [],
      scenarios: [],
    }));
    return buildTree(all);
  }

  fullContext(): Context {
    const tree = this.skillTree();

    // Load deck links: skillId -> Deck[]
    const deckLinks = new Map<number, Deck[]>();
    const drows = this.db
      .prepare(
        `SELECT ds.skill_id, d.id, d.name, COALESCE(d.description,'') as description, COUNT(c.id) as card_count, COUNT(cc.card_id) as covered_count, d.updated_at
         FROM deck_skills ds
         JOIN decks d ON d.id = ds.deck_id
         LEFT JOIN cards c ON c.deck_id = d.id
         LEFT JOIN card_coverage cc ON cc.card_id = c.id
         GROUP BY ds.skill_id, d.id
         ORDER BY d.name`,
      )
      .all() as any[];
    for (const r of drows) {
      const skillId = r.skill_id;
      const deck: Deck = {
        id: r.id,
        name: r.name,
        description: r.description,
        card_count: r.card_count,
        covered_count: r.covered_count,
        updated_at: r.updated_at,
      };
      if (!deckLinks.has(skillId)) deckLinks.set(skillId, []);
      deckLinks.get(skillId)!.push(deck);
    }

    // Load scenario links: skillId -> Scenario[]
    const scenarioLinks = new Map<number, Scenario[]>();
    const srows = this.db
      .prepare(
        `SELECT ss.skill_id, sc.id, sc.name, COALESCE(sc.description,'') as description, COALESCE(sc.repo_path,'') as repo_path,
                sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'') as completed_at
         FROM scenario_skills ss
         JOIN scenarios sc ON sc.id = ss.scenario_id
         ORDER BY sc.name`,
      )
      .all() as any[];
    for (const r of srows) {
      const skillId = r.skill_id;
      const scenario: Scenario = {
        id: r.id,
        name: r.name,
        description: r.description,
        repo_path: r.repo_path,
        status: r.status,
        skills: [],
        created_at: r.created_at,
        updated_at: r.updated_at,
        completed_at: r.completed_at,
      };
      if (!scenarioLinks.has(skillId)) scenarioLinks.set(skillId, []);
      scenarioLinks.get(skillId)!.push(scenario);
    }

    // Attach links to tree
    const attachLinks = (skills: Skill[]) => {
      for (const skill of skills) {
        if (deckLinks.has(skill.id)) skill.decks = deckLinks.get(skill.id)!;
        if (scenarioLinks.has(skill.id))
          skill.scenarios = scenarioLinks.get(skill.id)!;
        attachLinks(skill.children);
      }
    };
    attachLinks(tree);

    // Active scenarios
    const activeRows = this.db
      .prepare(
        `SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
         FROM scenarios
         WHERE status IN ('planned', 'in_progress')
         ORDER BY status DESC, name ASC`,
      )
      .all() as any[];
    const active: Scenario[] = activeRows.map((r) => ({ ...r, skills: [] }));

    return { skills: tree, active_scenarios: active };
  }

  // --- Deck CRUD ---

  createDeck(name: string, description: string): number {
    const result = this.db
      .prepare(`INSERT INTO decks(name, description) VALUES(?, ?)`)
      .run(name, description) as { lastInsertRowid: number };
    return Number(result.lastInsertRowid);
  }

  createDeckWithContents(
    name: string,
    description: string,
    skillIds: number[],
    cards: Card[],
  ): number {
    const tx = this.db.transaction(() => {
      const deckId = Number(
        (
          this.db
            .prepare(`INSERT INTO decks(name, description) VALUES(?, ?)`)
            .run(name, description) as { lastInsertRowid: number }
        ).lastInsertRowid,
      );
      for (const skillId of skillIds) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?, ?)`,
          )
          .run(deckId, skillId);
      }
      for (const card of cards) {
        this.insertCardInner(deckId, card);
      }
      return deckId;
    });
    return tx();
  }

  listDecks(): Deck[] {
    return this.db
      .prepare(
        `SELECT d.id, d.name, COALESCE(d.description,'') as description,
                COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id
         LEFT JOIN card_coverage cc ON cc.card_id = c.id
         GROUP BY d.id
         ORDER BY d.name ASC`,
      )
      .all() as Deck[];
  }

  getDeckByName(name: string): Deck {
    const row = this.db
      .prepare(
        `SELECT d.id, d.name, COALESCE(d.description,'') as description,
                COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id
         LEFT JOIN card_coverage cc ON cc.card_id = c.id
         WHERE d.name = ?
         GROUP BY d.id`,
      )
      .get(name) as Deck | null;
    if (!row) throw new Error(`deck "${name}" not found`);
    return row;
  }

  deleteDeckById(id: number): void {
    const result = this.db.prepare(`DELETE FROM decks WHERE id = ?`).run(id) as {
      changes: number;
    };
    if (result.changes === 0) throw new Error(`deck ${id} not found`);
  }

  // --- Coverage ---

  markCardCovered(cardId: number): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO card_coverage(card_id) VALUES(?)`)
      .run(cardId);
  }

  deckCoverage(deckId: number): { covered: number; total: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(c.id) as total, COUNT(cc.card_id) as covered
         FROM cards c
         LEFT JOIN card_coverage cc ON cc.card_id = c.id
         WHERE c.deck_id = ?`,
      )
      .get(deckId) as { total: number; covered: number };
    return row;
  }

  coveredCardIds(cardIds: number[]): Set<number> {
    if (cardIds.length === 0) return new Set();
    const placeholders = cardIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT card_id FROM card_coverage WHERE card_id IN (${placeholders})`,
      )
      .all(...cardIds) as { card_id: number }[];
    return new Set(rows.map((r) => r.card_id));
  }

  completeDeckCoverage(deckId: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO card_coverage(card_id)
         SELECT id FROM cards WHERE deck_id = ?`,
      )
      .run(deckId);
  }

  resetDeckCoverage(deckId: number): void {
    this.db
      .prepare(
        `DELETE FROM card_coverage
         WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`,
      )
      .run(deckId);
  }

  // --- Card CRUD ---

  insertCard(deckId: number, card: Card): number {
    const tx = this.db.transaction(() => {
      return this.insertCardInner(deckId, card);
    });
    return tx();
  }

  insertCards(deckId: number, cards: Card[]): void {
    const tx = this.db.transaction(() => {
      for (const card of cards) {
        this.insertCardInner(deckId, card);
      }
    });
    tx();
  }

  private insertCardInner(deckId: number, card: Card): number {
    const choicesValue = encodeChoices(card.choices);
    const extraValue = card.extra === "" ? null : card.extra;
    const result = this.db
      .prepare(
        `INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deckId,
        card.question,
        card.answer,
        extraValue,
        choicesValue,
        card.correct_index,
      ) as { lastInsertRowid: number };
    const id = Number(result.lastInsertRowid);
    this.replaceCardTags(id, card.tags);
    return id;
  }

  private replaceCardTags(cardId: number, tags: string[]): void {
    this.db.prepare(`DELETE FROM card_tags WHERE card_id = ?`).run(cardId);
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?, ?)`,
    );
    for (const tag of tags) {
      stmt.run(cardId, tag);
    }
  }

  listCards(deckId: number, limit: number): Card[] {
    if (limit <= 0) limit = 50;
    const rows = this.db
      .prepare(
        `SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
         FROM cards WHERE deck_id = ? ORDER BY id LIMIT ?`,
      )
      .all(deckId, limit) as any[];
    const cards = rows.map(scanCard);
    const cardIds = cards.map((c) => c.id);
    const tagsByCard = this.tagsForCards(cardIds);
    for (const card of cards) {
      card.tags = tagsByCard.get(card.id) ?? [];
    }
    return cards;
  }

  getCard(deckId: number, cardId: number): Card {
    const row = this.db
      .prepare(
        `SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
         FROM cards WHERE deck_id = ? AND id = ?`,
      )
      .get(deckId, cardId) as any;
    if (!row) throw new Error(`card ${cardId} not found in deck`);
    const card = scanCard(row);
    card.tags = this.tagsForCard(card.id);
    return card;
  }

  updateCard(deckId: number, cardId: number, update: CardUpdate): void {
    const tx = this.db.transaction(() => {
      const sets: string[] = [];
      const args: any[] = [];
      if (update.question !== undefined) {
        sets.push("question = ?");
        args.push(update.question);
      }
      if (update.answer !== undefined) {
        sets.push("answer = ?");
        args.push(update.answer);
      }
      if (update.extra !== undefined) {
        sets.push("extra = ?");
        args.push(update.extra === "" ? null : update.extra);
      }
      if (update.choices !== undefined) {
        sets.push("choices = ?");
        args.push(encodeChoices(update.choices));
      }
      if (update.correct_index !== undefined) {
        sets.push("correct_index = ?");
        args.push(update.correct_index);
      }

      if (sets.length > 0) {
        args.push(deckId, cardId);
        const query = `UPDATE cards SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE deck_id = ? AND id = ?`;
        const result = this.db.prepare(query).run(...args) as {
          changes: number;
        };
        if (result.changes === 0)
          throw new Error(`card ${cardId} not found in deck`);
      } else if (update.tags !== undefined) {
        this.ensureCard(deckId, cardId);
      }

      if (update.tags !== undefined) {
        this.replaceCardTags(cardId, update.tags);
      }
    });
    tx();
  }

  deleteCard(deckId: number, cardId: number): void {
    const result = this.db
      .prepare(`DELETE FROM cards WHERE deck_id = ? AND id = ?`)
      .run(deckId, cardId) as { changes: number };
    if (result.changes === 0)
      throw new Error(`card ${cardId} not found in deck`);
  }

  private ensureCard(deckId: number, cardId: number): void {
    const row = this.db
      .prepare(`SELECT 1 FROM cards WHERE deck_id = ? AND id = ?`)
      .get(deckId, cardId);
    if (!row) throw new Error(`card ${cardId} not found in deck`);
  }

  private tagsForCard(cardId: number): string[] {
    const rows = this.db
      .prepare(`SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag`)
      .all(cardId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  private tagsForCards(cardIds: number[]): Map<number, string[]> {
    if (cardIds.length === 0) return new Map();
    const placeholders = cardIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT card_id, tag FROM card_tags WHERE card_id IN (${placeholders}) ORDER BY card_id, tag`,
      )
      .all(...cardIds) as { card_id: number; tag: string }[];
    const map = new Map<number, string[]>();
    for (const r of rows) {
      if (!map.has(r.card_id)) map.set(r.card_id, []);
      map.get(r.card_id)!.push(r.tag);
    }
    return map;
  }

  // --- Scenario CRUD ---

  createScenario(
    name: string,
    description: string,
    repoPath: string,
    skillIds: number[],
  ): number {
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO scenarios(name, description, repo_path) VALUES(?, ?, ?)`,
        )
        .run(
          name,
          description || null,
          repoPath || null,
        ) as { lastInsertRowid: number };
      const id = Number(result.lastInsertRowid);
      for (const sid of skillIds) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?, ?)`,
          )
          .run(id, sid);
      }
      return id;
    });
    return tx();
  }

  listScenarios(status: string): Scenario[] {
    const query = status
      ? `SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
         FROM scenarios WHERE status = ? ORDER BY name ASC`
      : `SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
         FROM scenarios ORDER BY name ASC`;
    const rows = (status
      ? this.db.prepare(query).all(status)
      : this.db.prepare(query).all()) as any[];
    const scenarios: Scenario[] = rows.map((r) => ({ ...r, skills: [] }));
    for (const sc of scenarios) {
      sc.skills = this.skillsForScenario(sc.id);
    }
    return scenarios;
  }

  getScenario(id: number): Scenario {
    const row = this.db
      .prepare(
        `SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
         FROM scenarios WHERE id = ?`,
      )
      .get(id) as any;
    if (!row) throw new Error(`scenario ${id} not found`);
    const sc: Scenario = { ...row, skills: [] };
    sc.skills = this.skillsForScenario(id);
    return sc;
  }

  updateScenario(id: number, update: ScenarioUpdate): void {
    const sets: string[] = [];
    const args: any[] = [];
    if (update.name !== undefined) {
      sets.push("name = ?");
      args.push(update.name);
    }
    if (update.description !== undefined) {
      sets.push("description = ?");
      args.push(update.description === "" ? null : update.description);
    }
    if (update.repo_path !== undefined) {
      sets.push("repo_path = ?");
      args.push(update.repo_path === "" ? null : update.repo_path);
    }
    if (update.status !== undefined) {
      sets.push("status = ?");
      args.push(update.status);
      if (update.status === "completed") {
        sets.push("completed_at = CURRENT_TIMESTAMP");
      }
    }
    if (sets.length === 0) return;
    args.push(id);
    const query = `UPDATE scenarios SET ${sets.join(", ")} WHERE id = ?`;
    const result = this.db.prepare(query).run(...args) as { changes: number };
    if (result.changes === 0) throw new Error(`scenario ${id} not found`);
  }

  deleteScenario(id: number): void {
    const result = this.db
      .prepare(`DELETE FROM scenarios WHERE id = ?`)
      .run(id) as { changes: number };
    if (result.changes === 0) throw new Error(`scenario ${id} not found`);
  }

  private skillsForScenario(scenarioId: number): Skill[] {
    const rows = this.db
      .prepare(
        `SELECT sk.id, sk.parent_id, sk.name, COALESCE(sk.description,'') as description, sk.level, sk.created_at, sk.updated_at
         FROM scenario_skills ss
         JOIN skills sk ON sk.id = ss.skill_id
         WHERE ss.scenario_id = ?
         ORDER BY sk.name`,
      )
      .all(scenarioId) as any[];
    return rows.map((r) => ({
      ...r,
      parent_id: r.parent_id ?? null,
      children: [],
      decks: [],
      scenarios: [],
    }));
  }

  // --- Junction tables ---

  linkDeckSkill(deckId: number, skillId: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?, ?)`,
      )
      .run(deckId, skillId);
  }

  unlinkDeckSkill(deckId: number, skillId: number): void {
    this.db
      .prepare(`DELETE FROM deck_skills WHERE deck_id = ? AND skill_id = ?`)
      .run(deckId, skillId);
  }

  linkScenarioSkill(scenarioId: number, skillId: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?, ?)`,
      )
      .run(scenarioId, skillId);
  }

  unlinkScenarioSkill(scenarioId: number, skillId: number): void {
    this.db
      .prepare(
        `DELETE FROM scenario_skills WHERE scenario_id = ? AND skill_id = ?`,
      )
      .run(scenarioId, skillId);
  }

  // --- Review by skill ---

  cardsForSkill(skillId: number, limit: number): Card[] {
    if (limit <= 0) limit = 50;
    const skillIds = this.descendantSkillIds(skillId);
    skillIds.push(skillId);

    const placeholders = skillIds.map(() => "?").join(",");
    const drows = this.db
      .prepare(
        `SELECT DISTINCT deck_id FROM deck_skills WHERE skill_id IN (${placeholders})`,
      )
      .all(...skillIds) as { deck_id: number }[];
    const deckIds = drows.map((r) => r.deck_id);
    if (deckIds.length === 0) return [];

    const dPlaceholders = deckIds.map(() => "?").join(",");
    const crows = this.db
      .prepare(
        `SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
         FROM cards WHERE deck_id IN (${dPlaceholders}) ORDER BY id LIMIT ?`,
      )
      .all(...deckIds, limit) as any[];
    const cards = crows.map(scanCard);
    const cardIds = cards.map((c) => c.id);
    const tagsByCard = this.tagsForCards(cardIds);
    for (const card of cards) {
      card.tags = tagsByCard.get(card.id) ?? [];
    }
    return cards;
  }

  private descendantSkillIds(parentId: number): number[] {
    const rows = this.db
      .prepare(`SELECT id FROM skills WHERE parent_id = ?`)
      .all(parentId) as { id: number }[];
    const ids = rows.map((r) => r.id);
    const allDesc = [...ids];
    for (const childId of ids) {
      allDesc.push(...this.descendantSkillIds(childId));
    }
    return allDesc;
  }

  // --- Import from quiz ---

  importFromQuiz(quizDBPath: string): { decks: number; cards: number } {
    const quizDB = new Database(quizDBPath, { readonly: true });
    try {
      const qdecks = quizDB
        .prepare(
          `SELECT id, name, COALESCE(description,'') as description FROM decks ORDER BY id`,
        )
        .all() as { id: number; name: string; description: string }[];

      const existingDecks = this.listDecks();
      const existingNames = new Set(existingDecks.map((d) => d.name));

      let decksImported = 0;
      let cardsImported = 0;

      const tx = this.db.transaction(() => {
        for (const qd of qdecks) {
          if (existingNames.has(qd.name)) continue;

          const deckResult = this.db
            .prepare(`INSERT INTO decks(name, description) VALUES(?, ?)`)
            .run(qd.name, qd.description) as { lastInsertRowid: number };
          const newDeckId = Number(deckResult.lastInsertRowid);
          existingNames.add(qd.name);
          decksImported++;

          const qcards = quizDB
            .prepare(
              `SELECT id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
               FROM cards WHERE deck_id = ? ORDER BY id`,
            )
            .all(qd.id) as any[];

          for (const qc of qcards) {
            const choices = decodeChoices(qc.choices);
            const choicesValue = encodeChoices(choices);
            const extraValue = qc.extra === "" ? null : qc.extra;
            const ciValue =
              qc.correct_index !== null ? qc.correct_index : null;

            const cardResult = this.db
              .prepare(
                `INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?, ?, ?, ?, ?, ?)`,
              )
              .run(
                newDeckId,
                qc.question,
                qc.answer,
                extraValue,
                choicesValue,
                ciValue,
              ) as { lastInsertRowid: number };
            const newCardId = Number(cardResult.lastInsertRowid);

            const qtags = quizDB
              .prepare(
                `SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag`,
              )
              .all(qc.id) as { tag: string }[];
            for (const qt of qtags) {
              this.db
                .prepare(
                  `INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?, ?)`,
                )
                .run(newCardId, qt.tag);
            }

            cardsImported++;
          }
        }
      });
      tx();
      return { decks: decksImported, cards: cardsImported };
    } finally {
      quizDB.close();
    }
  }
}

// --- Helpers ---

function scanCard(row: any): Card {
  return {
    id: row.id,
    deck_id: row.deck_id,
    question: row.question,
    answer: row.answer,
    extra: row.extra ?? "",
    choices: decodeChoices(row.choices),
    correct_index: row.correct_index ?? null,
    tags: [],
  };
}

function buildTree(all: Skill[]): Skill[] {
  const byId = new Map<number, Skill>();
  for (const sk of all) {
    sk.children = [];
    byId.set(sk.id, sk);
  }

  const roots: Skill[] = [];
  for (const sk of all) {
    if (sk.parent_id != null) {
      const parent = byId.get(sk.parent_id);
      if (parent) parent.children.push(sk);
    } else {
      roots.push(sk);
    }
  }

  const populate = (skills: Skill[]): Skill[] => {
    for (const sk of skills) {
      const node = byId.get(sk.id);
      if (node) sk.children = populate(node.children);
    }
    return skills;
  };
  return populate(roots);
}
