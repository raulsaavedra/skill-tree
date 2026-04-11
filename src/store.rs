use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use cli_core::{open_sqlite, OpenOptions};
use rusqlite::{params, Connection};
use serde::Serialize;

// --- Types ---

#[derive(Debug, Clone, Serialize)]
pub struct Skill {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub description: String,
    pub level: Option<i64>,
    pub children: Vec<Skill>,
    pub decks: Vec<Deck>,
    pub scenarios: Vec<Scenario>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Scenario {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub status: String,
    pub skills: Vec<Skill>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioStep {
    pub id: i64,
    pub scenario_id: i64,
    pub position: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScenarioProgress {
    pub total_steps: i64,
    pub planned_steps: i64,
    pub in_progress_steps: i64,
    pub completed_steps: i64,
    pub blocked_steps: i64,
    pub skipped_steps: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioDetail {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub status: String,
    pub skills: Vec<Skill>,
    pub steps: Vec<ScenarioStep>,
    pub progress: ScenarioProgress,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillRef {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveScenarioSummary {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub status: String,
    pub skills: Vec<SkillRef>,
    pub progress: ScenarioProgress,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Deck {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub card_count: i64,
    pub covered_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Card {
    pub id: i64,
    pub deck_id: i64,
    pub question: String,
    pub answer: String,
    pub extra: String,
    pub choices: Vec<String>,
    pub correct_index: Option<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Context {
    pub skills: Vec<Skill>,
    pub active_scenarios: Vec<ActiveScenarioSummary>,
}

fn attach_links(
    skills: &mut [Skill],
    deck_links: &HashMap<i64, Vec<Deck>>,
    scenario_links: &HashMap<i64, Vec<Scenario>>,
) {
    for skill in skills.iter_mut() {
        if let Some(decks) = deck_links.get(&skill.id) {
            skill.decks = decks.clone();
        }
        if let Some(scenarios) = scenario_links.get(&skill.id) {
            skill.scenarios = scenarios.clone();
        }
        attach_links(&mut skill.children, deck_links, scenario_links);
    }
}

fn find_skill_subtree(skills: &[Skill], skill_id: i64) -> Option<Skill> {
    for skill in skills {
        if skill.id == skill_id {
            return Some(skill.clone());
        }
        if let Some(found) = find_skill_subtree(&skill.children, skill_id) {
            return Some(found);
        }
    }
    None
}

// --- Validation ---

pub fn validate_level(level: i64) -> Result<(), String> {
    if level < 0 || level > 5 {
        Err(format!("level must be 0-5, got {level}"))
    } else {
        Ok(())
    }
}

const VALID_STATUSES: &[&str] = &["planned", "in_progress", "completed", "abandoned"];
const VALID_STEP_STATUSES: &[&str] = &["planned", "in_progress", "completed", "blocked", "skipped"];

pub fn validate_status(status: &str) -> Result<(), String> {
    if VALID_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(format!(
            "status must be one of: planned, in_progress, completed, abandoned; got \"{status}\""
        ))
    }
}

pub fn validate_step_status(status: &str) -> Result<(), String> {
    if VALID_STEP_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(format!(
            "step status must be one of: planned, in_progress, completed, blocked, skipped; got \"{status}\""
        ))
    }
}

// --- Choice encoding ---

const CHOICE_SEPARATOR: &str = "|␟|";

fn encode_choices(choices: &[String]) -> Option<String> {
    if choices.is_empty() {
        None
    } else {
        Some(choices.join(CHOICE_SEPARATOR))
    }
}

fn decode_choices(raw: Option<&str>) -> Vec<String> {
    match raw {
        None => vec![],
        Some(s) if s.is_empty() => vec![],
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.starts_with('[') {
                if let Ok(parsed) = serde_json::from_str::<Vec<String>>(s) {
                    return parsed;
                }
            }
            s.split(CHOICE_SEPARATOR).map(|p| p.to_string()).collect()
        }
    }
}

// --- Migration ---

fn migrate_old_data_dir() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let old_dir = home.join(".skill-builder");
    let new_dir = home.join(".skill-tree");

    if new_dir.exists() {
        return;
    }
    if !old_dir.exists() {
        return;
    }

    let old_db = old_dir.join("skill-builder.db");
    let new_db = old_dir.join("skill-tree.db");
    if old_db.exists() {
        let _ = fs::rename(&old_db, &new_db);
    }
    let _ = fs::rename(&old_dir, &new_dir);
}

fn migrate(db: &Connection) -> Result<(), String> {
    let stmts = [
        "CREATE TABLE IF NOT EXISTS skills (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id   INTEGER REFERENCES skills(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            description TEXT,
            level       INTEGER DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        "CREATE TABLE IF NOT EXISTS decks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        "CREATE TABLE IF NOT EXISTS cards (
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
        )",
        "CREATE TABLE IF NOT EXISTS card_tags (
            card_id INTEGER NOT NULL,
            tag     TEXT NOT NULL,
            PRIMARY KEY(card_id, tag),
            FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
        )",
        "CREATE TABLE IF NOT EXISTS scenarios (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            description  TEXT,
            repo_path    TEXT,
            status       TEXT NOT NULL DEFAULT 'planned',
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        )",
        "CREATE TABLE IF NOT EXISTS scenario_steps (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            position     INTEGER NOT NULL,
            title        TEXT NOT NULL,
            description  TEXT,
            status       TEXT NOT NULL DEFAULT 'planned',
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            UNIQUE (scenario_id, position)
        )",
        "CREATE TABLE IF NOT EXISTS scenario_skills (
            scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            PRIMARY KEY (scenario_id, skill_id)
        )",
        "CREATE TABLE IF NOT EXISTS deck_skills (
            deck_id  INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            PRIMARY KEY (deck_id, skill_id)
        )",
        "CREATE TABLE IF NOT EXISTS card_coverage (
            card_id    INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
            covered_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        "CREATE TRIGGER IF NOT EXISTS cards_updated_at AFTER UPDATE ON cards
        BEGIN
            UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
        END",
        "CREATE TRIGGER IF NOT EXISTS cards_inserted_at AFTER INSERT ON cards
        BEGIN
            UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
        END",
        "CREATE TRIGGER IF NOT EXISTS skills_updated_at AFTER UPDATE ON skills
        FOR EACH ROW BEGIN
            UPDATE skills SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END",
        "CREATE TRIGGER IF NOT EXISTS scenarios_updated_at AFTER UPDATE ON scenarios
        FOR EACH ROW BEGIN
            UPDATE scenarios SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END",
        "CREATE TRIGGER IF NOT EXISTS scenario_steps_updated_at AFTER UPDATE ON scenario_steps
        FOR EACH ROW BEGIN
            UPDATE scenario_steps SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END",
    ];
    for stmt in &stmts {
        db.execute_batch(stmt)
            .map_err(|e| format!("migration error: {e}"))?;
    }
    Ok(())
}

// --- Store ---

pub struct Store {
    pub db: Connection,
    #[allow(dead_code)]
    pub path: PathBuf,
}

fn scenario_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Scenario> {
    Ok(Scenario {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        repo_path: row.get(3)?,
        status: row.get(4)?,
        skills: vec![],
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        completed_at: row.get(7)?,
    })
}

fn scenario_step_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScenarioStep> {
    Ok(ScenarioStep {
        id: row.get(0)?,
        scenario_id: row.get(1)?,
        position: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

fn scenario_progress(steps: &[ScenarioStep]) -> ScenarioProgress {
    let mut progress = ScenarioProgress {
        total_steps: steps.len() as i64,
        ..ScenarioProgress::default()
    };

    for step in steps {
        match step.status.as_str() {
            "planned" => progress.planned_steps += 1,
            "in_progress" => progress.in_progress_steps += 1,
            "completed" => progress.completed_steps += 1,
            "blocked" => progress.blocked_steps += 1,
            "skipped" => progress.skipped_steps += 1,
            _ => {}
        }
    }

    progress
}

impl Store {
    pub fn open() -> Result<Store, String> {
        migrate_old_data_dir();
        let (db, path) = open_sqlite(&OpenOptions {
            app_name: "skill-tree".into(),
            filename: "skill-tree.db".into(),
            path: None,
            pragmas: vec!["foreign_keys = ON".into()],
            migrate: Some(migrate),
        })?;
        Ok(Store { db, path })
    }

    fn with_transaction<T, F>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Store) -> Result<T, String>,
    {
        self.db
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        match f(self) {
            Ok(value) => {
                if let Err(e) = self.db.execute_batch("COMMIT") {
                    let _ = self.db.execute_batch("ROLLBACK");
                    return Err(e.to_string());
                }
                Ok(value)
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn ensure_scenario_exists(&self, scenario_id: i64) -> Result<(), String> {
        self.db
            .query_row(
                "SELECT 1 FROM scenarios WHERE id = ?1",
                params![scenario_id],
                |_| Ok(()),
            )
            .map_err(|_| format!("scenario {scenario_id} not found"))
    }

    fn skill_depth(&self, skill_id: i64) -> Result<usize, String> {
        let mut depth = 0usize;
        let mut current_id = skill_id;

        loop {
            let parent_id: Option<i64> = self
                .db
                .query_row(
                    "SELECT parent_id FROM skills WHERE id = ?1",
                    params![current_id],
                    |row| row.get(0),
                )
                .map_err(|_| format!("skill {skill_id} not found"))?;

            match parent_id {
                Some(parent_id) => {
                    depth += 1;
                    current_id = parent_id;
                }
                None => return Ok(depth),
            }
        }
    }

    fn child_skill_depth(&self, parent_id: Option<i64>) -> Result<usize, String> {
        match parent_id {
            None => Ok(0),
            Some(parent_id) => Ok(self.skill_depth(parent_id)? + 1),
        }
    }

    fn normalize_skill_level_for_depth(
        &self,
        depth: usize,
        level: Option<i64>,
    ) -> Result<Option<i64>, String> {
        match (depth, level) {
            (0..=1, Some(level)) => {
                validate_level(level)?;
                Ok(Some(level))
            }
            (0..=1, None) => Ok(Some(0)),
            (_, Some(_)) => Err("skills at depth 2+ do not support levels".into()),
            (_, None) => Ok(None),
        }
    }

    fn scenario_step_ids(&self, scenario_id: i64) -> Result<Vec<i64>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id FROM scenario_steps WHERE scenario_id = ?1 ORDER BY position ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map(params![scenario_id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(ids)
    }

    fn renumber_scenario_steps(&self, ordered_ids: &[i64]) -> Result<(), String> {
        for (idx, step_id) in ordered_ids.iter().enumerate() {
            self.db
                .execute(
                    "UPDATE scenario_steps SET position = ?1 WHERE id = ?2",
                    params![-((idx as i64) + 1), step_id],
                )
                .map_err(|e| e.to_string())?;
        }
        for (idx, step_id) in ordered_ids.iter().enumerate() {
            self.db
                .execute(
                    "UPDATE scenario_steps SET position = ?1 WHERE id = ?2",
                    params![idx as i64 + 1, step_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn build_scenario_detail(&self, mut scenario: Scenario) -> Result<ScenarioDetail, String> {
        scenario.skills = self.skills_for_scenario(scenario.id)?;
        let steps = self.list_scenario_steps(scenario.id)?;
        let progress = scenario_progress(&steps);

        Ok(ScenarioDetail {
            id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            repo_path: scenario.repo_path,
            status: scenario.status,
            skills: scenario.skills,
            steps,
            progress,
            created_at: scenario.created_at,
            updated_at: scenario.updated_at,
            completed_at: scenario.completed_at,
        })
    }

    fn build_active_scenario_summary(
        &self,
        scenario: Scenario,
    ) -> Result<ActiveScenarioSummary, String> {
        let skills = self
            .skills_for_scenario(scenario.id)?
            .into_iter()
            .map(|skill| SkillRef {
                id: skill.id,
                name: skill.name,
            })
            .collect();
        let steps = self.list_scenario_steps(scenario.id)?;
        let progress = scenario_progress(&steps);

        Ok(ActiveScenarioSummary {
            id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            repo_path: scenario.repo_path,
            status: scenario.status,
            skills,
            progress,
            updated_at: scenario.updated_at,
        })
    }

    // --- Skill CRUD ---

    pub fn create_skill(
        &self,
        name: &str,
        description: &str,
        parent_id: Option<i64>,
        level: Option<i64>,
    ) -> Result<i64, String> {
        let desc = if description.is_empty() {
            None
        } else {
            Some(description)
        };
        let depth = self.child_skill_depth(parent_id)?;
        let level = self.normalize_skill_level_for_depth(depth, level)?;
        self.db
            .execute(
                "INSERT INTO skills(name, description, parent_id, level) VALUES(?1, ?2, ?3, ?4)",
                params![name, desc, parent_id, level],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn list_skills(&self, parent_id: Option<i64>) -> Result<Vec<Skill>, String> {
        let (query, rows) = match parent_id {
            None => {
                let mut stmt = self
                    .db
                    .prepare(
                        "SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
                         FROM skills WHERE parent_id IS NULL ORDER BY name ASC",
                    )
                    .map_err(|e| e.to_string())?;
                let rows: Vec<Skill> = stmt
                    .query_map([], |row| {
                        Ok(Skill {
                            id: row.get(0)?,
                            parent_id: row.get(1)?,
                            name: row.get(2)?,
                            description: row.get(3)?,
                            level: row.get(4)?,
                            children: vec![],
                            decks: vec![],
                            scenarios: vec![],
                            created_at: row.get(5)?,
                            updated_at: row.get(6)?,
                        })
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                (String::new(), rows)
            }
            Some(pid) => {
                let mut stmt = self
                    .db
                    .prepare(
                        "SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
                         FROM skills WHERE parent_id = ?1 ORDER BY name ASC",
                    )
                    .map_err(|e| e.to_string())?;
                let rows: Vec<Skill> = stmt
                    .query_map(params![pid], |row| {
                        Ok(Skill {
                            id: row.get(0)?,
                            parent_id: row.get(1)?,
                            name: row.get(2)?,
                            description: row.get(3)?,
                            level: row.get(4)?,
                            children: vec![],
                            decks: vec![],
                            scenarios: vec![],
                            created_at: row.get(5)?,
                            updated_at: row.get(6)?,
                        })
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                (String::new(), rows)
            }
        };
        let _ = query;
        Ok(rows)
    }

    pub fn get_skill(&self, id: i64) -> Result<Skill, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
                 FROM skills WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut skill: Skill = stmt
            .query_row(params![id], |row| {
                Ok(Skill {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    level: row.get(4)?,
                    children: vec![],
                    decks: vec![],
                    scenarios: vec![],
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|_| format!("skill {id} not found"))?;
        self.load_skill_links(&mut skill)?;
        skill.children = self.get_child_skills(id)?;
        Ok(skill)
    }

    fn get_child_skills(&self, parent_id: i64) -> Result<Vec<Skill>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
                 FROM skills WHERE parent_id = ?1 ORDER BY name ASC",
            )
            .map_err(|e| e.to_string())?;
        let mut children: Vec<Skill> = stmt
            .query_map(params![parent_id], |row| {
                Ok(Skill {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    level: row.get(4)?,
                    children: vec![],
                    decks: vec![],
                    scenarios: vec![],
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for child in &mut children {
            self.load_skill_links(child)?;
        }
        Ok(children)
    }

    fn load_skill_links(&self, skill: &mut Skill) -> Result<(), String> {
        // Linked decks
        let mut dstmt = self
            .db
            .prepare(
                "SELECT d.id, d.name, COALESCE(d.description,'') as description, COUNT(c.id) as card_count, COUNT(cc.card_id) as covered_count, d.updated_at
                 FROM deck_skills ds
                 JOIN decks d ON d.id = ds.deck_id
                 LEFT JOIN cards c ON c.deck_id = d.id
                 LEFT JOIN card_coverage cc ON cc.card_id = c.id
                 WHERE ds.skill_id = ?1
                 GROUP BY d.id
                 ORDER BY d.name",
            )
            .map_err(|e| e.to_string())?;
        skill.decks = dstmt
            .query_map(params![skill.id], |row| {
                Ok(Deck {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    card_count: row.get(3)?,
                    covered_count: row.get(4)?,
                    updated_at: row.get::<_, String>(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // Linked scenarios
        let mut sstmt = self
            .db
            .prepare(
                "SELECT sc.id, sc.name, COALESCE(sc.description,'') as description, COALESCE(sc.repo_path,'') as repo_path,
                        sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'') as completed_at
                 FROM scenario_skills ss
                 JOIN scenarios sc ON sc.id = ss.scenario_id
                 WHERE ss.skill_id = ?1
                 ORDER BY sc.name",
            )
            .map_err(|e| e.to_string())?;
        skill.scenarios = sstmt
            .query_map(params![skill.id], scenario_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn update_skill(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<&str>,
        level: Option<i64>,
    ) -> Result<(), String> {
        let depth = self.skill_depth(id)?;
        let mut sets = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(n) = name {
            sets.push("name = ?");
            args.push(Box::new(n.to_string()));
        }
        if let Some(d) = description {
            sets.push("description = ?");
            let val: Option<String> = if d.is_empty() {
                None
            } else {
                Some(d.to_string())
            };
            args.push(Box::new(val));
        }
        if let Some(l) = level {
            if depth >= 2 {
                return Err("skills at depth 2+ do not support levels".into());
            }
            validate_level(l)?;
            sets.push("level = ?");
            args.push(Box::new(l));
        }
        if sets.is_empty() {
            return Ok(());
        }
        args.push(Box::new(id));
        let query = format!("UPDATE skills SET {} WHERE id = ?", sets.join(", "));
        let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|a| a.as_ref()).collect();
        let changes = self
            .db
            .execute(&query, params.as_slice())
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("skill {id} not found"));
        }
        Ok(())
    }

    pub fn delete_skill(&self, id: i64) -> Result<(), String> {
        let changes = self
            .db
            .execute("DELETE FROM skills WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("skill {id} not found"));
        }
        Ok(())
    }

    pub fn skill_tree(&self) -> Result<Vec<Skill>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, parent_id, name, COALESCE(description,'') as description, level, created_at, updated_at
                 FROM skills ORDER BY name ASC",
            )
            .map_err(|e| e.to_string())?;
        let all: Vec<Skill> = stmt
            .query_map([], |row| {
                Ok(Skill {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    level: row.get(4)?,
                    children: vec![],
                    decks: vec![],
                    scenarios: vec![],
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(build_tree(all))
    }

    fn context_links(
        &self,
    ) -> Result<(HashMap<i64, Vec<Deck>>, HashMap<i64, Vec<Scenario>>), String> {
        let mut deck_links: HashMap<i64, Vec<Deck>> = HashMap::new();
        {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT ds.skill_id, d.id, d.name, COALESCE(d.description,'') as description, COUNT(c.id) as card_count, COUNT(cc.card_id) as covered_count, d.updated_at
                     FROM deck_skills ds
                     JOIN decks d ON d.id = ds.deck_id
                     LEFT JOIN cards c ON c.deck_id = d.id
                     LEFT JOIN card_coverage cc ON cc.card_id = c.id
                     GROUP BY ds.skill_id, d.id
                     ORDER BY d.name",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        Deck {
                            id: row.get(1)?,
                            name: row.get(2)?,
                            description: row.get(3)?,
                            card_count: row.get(4)?,
                            covered_count: row.get(5)?,
                            updated_at: row.get(6)?,
                        },
                    ))
                })
                .map_err(|e| e.to_string())?;
            for r in rows {
                let (skill_id, deck) = r.map_err(|e| e.to_string())?;
                deck_links.entry(skill_id).or_default().push(deck);
            }
        }

        // Load scenario links: skill_id -> Vec<Scenario>
        let mut scenario_links: HashMap<i64, Vec<Scenario>> = HashMap::new();
        {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT ss.skill_id, sc.id, sc.name, COALESCE(sc.description,'') as description, COALESCE(sc.repo_path,'') as repo_path,
                            sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'') as completed_at
                     FROM scenario_skills ss
                     JOIN scenarios sc ON sc.id = ss.scenario_id
                     ORDER BY sc.name",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        Scenario {
                            id: row.get(1)?,
                            name: row.get(2)?,
                            description: row.get(3)?,
                            repo_path: row.get(4)?,
                            status: row.get(5)?,
                            skills: vec![],
                            created_at: row.get(6)?,
                            updated_at: row.get(7)?,
                            completed_at: row.get(8)?,
                        },
                    ))
                })
                .map_err(|e| e.to_string())?;
            for r in rows {
                let (skill_id, scenario) = r.map_err(|e| e.to_string())?;
                scenario_links.entry(skill_id).or_default().push(scenario);
            }
        }
        Ok((deck_links, scenario_links))
    }

    fn active_scenarios_for_skill_ids(
        &self,
        skill_ids: &[i64],
    ) -> Result<Vec<ActiveScenarioSummary>, String> {
        let active: Vec<Scenario> = if skill_ids.is_empty() {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                            status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
                     FROM scenarios
                     WHERE status IN ('planned', 'in_progress')
                     ORDER BY status DESC, name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], scenario_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        } else {
            let placeholders: Vec<String> =
                (1..=skill_ids.len()).map(|i| format!("?{i}")).collect();
            let query = format!(
                "SELECT DISTINCT sc.id, sc.name, COALESCE(sc.description,'') as description, COALESCE(sc.repo_path,'') as repo_path,
                        sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'') as completed_at
                 FROM scenarios sc
                 JOIN scenario_skills ss ON ss.scenario_id = sc.id
                 WHERE sc.status IN ('planned', 'in_progress')
                   AND ss.skill_id IN ({})
                 ORDER BY sc.status DESC, sc.name ASC",
                placeholders.join(",")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> = skill_ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let mut stmt = self.db.prepare(&query).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params.as_slice(), scenario_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };

        active
            .into_iter()
            .map(|scenario| self.build_active_scenario_summary(scenario))
            .collect::<Result<Vec<_>, _>>()
    }

    pub fn full_context(&self) -> Result<Context, String> {
        let mut tree = self.skill_tree()?;
        let (deck_links, scenario_links) = self.context_links()?;
        attach_links(&mut tree, &deck_links, &scenario_links);
        let active_scenarios = self.active_scenarios_for_skill_ids(&[])?;

        Ok(Context {
            skills: tree,
            active_scenarios,
        })
    }

    pub fn scoped_context(&self, skill_id: i64) -> Result<Context, String> {
        let mut tree = self.skill_tree()?;
        let (deck_links, scenario_links) = self.context_links()?;
        attach_links(&mut tree, &deck_links, &scenario_links);
        let skill = find_skill_subtree(&tree, skill_id)
            .ok_or_else(|| format!("skill {skill_id} not found"))?;

        let mut skill_ids = self.descendant_skill_ids(skill_id)?;
        skill_ids.push(skill_id);
        let active_scenarios = self.active_scenarios_for_skill_ids(&skill_ids)?;

        Ok(Context {
            skills: vec![skill],
            active_scenarios,
        })
    }

    // --- Deck CRUD ---

    pub fn create_deck_with_contents(
        &self,
        name: &str,
        description: &str,
        skill_ids: &[i64],
        cards: &[Card],
    ) -> Result<i64, String> {
        let deck_id: i64 = {
            self.db
                .execute(
                    "INSERT INTO decks(name, description) VALUES(?1, ?2)",
                    params![name, description],
                )
                .map_err(|e| e.to_string())?;
            self.db.last_insert_rowid()
        };
        for &sid in skill_ids {
            self.db
                .execute(
                    "INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?1, ?2)",
                    params![deck_id, sid],
                )
                .map_err(|e| e.to_string())?;
        }
        for card in cards {
            self.insert_card_inner(deck_id, card)?;
        }
        Ok(deck_id)
    }

    pub fn list_decks(&self) -> Result<Vec<Deck>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT d.id, d.name, COALESCE(d.description,'') as description,
                        COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
                 FROM decks d
                 LEFT JOIN cards c ON c.deck_id = d.id
                 LEFT JOIN card_coverage cc ON cc.card_id = c.id
                 GROUP BY d.id
                 ORDER BY d.name ASC",
            )
            .map_err(|e| e.to_string())?;
        let decks = stmt
            .query_map([], |row| {
                Ok(Deck {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    card_count: row.get(3)?,
                    covered_count: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(decks)
    }

    pub fn get_deck_by_name(&self, name: &str) -> Result<Deck, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT d.id, d.name, COALESCE(d.description,'') as description,
                        COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
                 FROM decks d
                 LEFT JOIN cards c ON c.deck_id = d.id
                 LEFT JOIN card_coverage cc ON cc.card_id = c.id
                 WHERE d.name = ?1
                 GROUP BY d.id",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![name], |row| {
            Ok(Deck {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                card_count: row.get(3)?,
                covered_count: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|_| format!("deck \"{name}\" not found"))
    }

    pub fn delete_deck_by_id(&self, id: i64) -> Result<(), String> {
        let changes = self
            .db
            .execute("DELETE FROM decks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("deck {id} not found"));
        }
        Ok(())
    }

    // --- Coverage ---

    pub fn mark_card_covered(&self, card_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO card_coverage(card_id) VALUES(?1)",
                params![card_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn covered_card_ids(&self, card_ids: &[i64]) -> Result<HashSet<i64>, String> {
        if card_ids.is_empty() {
            return Ok(HashSet::new());
        }
        let placeholders: Vec<String> = (1..=card_ids.len()).map(|i| format!("?{i}")).collect();
        let query = format!(
            "SELECT card_id FROM card_coverage WHERE card_id IN ({})",
            placeholders.join(",")
        );
        let mut stmt = self.db.prepare(&query).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::types::ToSql> = card_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt
            .query_map(params.as_slice(), |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        let mut set = HashSet::new();
        for r in rows {
            set.insert(r.map_err(|e| e.to_string())?);
        }
        Ok(set)
    }

    pub fn complete_deck_coverage(&self, deck_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO card_coverage(card_id)
                 SELECT id FROM cards WHERE deck_id = ?1",
                params![deck_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reset_deck_coverage(&self, deck_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM card_coverage
                 WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?1)",
                params![deck_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Card CRUD ---

    pub fn insert_card(&self, deck_id: i64, card: &Card) -> Result<i64, String> {
        self.insert_card_inner(deck_id, card)
    }

    pub fn insert_cards(&self, deck_id: i64, cards: &[Card]) -> Result<(), String> {
        for card in cards {
            self.insert_card_inner(deck_id, card)?;
        }
        Ok(())
    }

    fn insert_card_inner(&self, deck_id: i64, card: &Card) -> Result<i64, String> {
        let choices_value = encode_choices(&card.choices);
        let extra_value: Option<&str> = if card.extra.is_empty() {
            None
        } else {
            Some(&card.extra)
        };
        self.db
            .execute(
                "INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![deck_id, card.question, card.answer, extra_value, choices_value, card.correct_index],
            )
            .map_err(|e| e.to_string())?;
        let id = self.db.last_insert_rowid();
        self.replace_card_tags(id, &card.tags)?;
        Ok(id)
    }

    fn replace_card_tags(&self, card_id: i64, tags: &[String]) -> Result<(), String> {
        self.db
            .execute("DELETE FROM card_tags WHERE card_id = ?1", params![card_id])
            .map_err(|e| e.to_string())?;
        for tag in tags {
            self.db
                .execute(
                    "INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?1, ?2)",
                    params![card_id, tag],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_cards(&self, deck_id: i64, limit: i64) -> Result<Vec<Card>, String> {
        let limit = if limit <= 0 { 50 } else { limit };
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
                 FROM cards WHERE deck_id = ?1 ORDER BY id LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let cards: Vec<Card> = stmt
            .query_map(params![deck_id, limit], |row| Ok(scan_card(row)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let card_ids: Vec<i64> = cards.iter().map(|c| c.id).collect();
        let tags_by_card = self.tags_for_cards(&card_ids)?;
        let mut cards = cards;
        for card in &mut cards {
            if let Some(tags) = tags_by_card.get(&card.id) {
                card.tags = tags.clone();
            }
        }
        Ok(cards)
    }

    pub fn get_card(&self, deck_id: i64, card_id: i64) -> Result<Card, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
                 FROM cards WHERE deck_id = ?1 AND id = ?2",
            )
            .map_err(|e| e.to_string())?;
        let mut card: Card = stmt
            .query_row(params![deck_id, card_id], |row| Ok(scan_card(row)))
            .map_err(|_| format!("card {card_id} not found in deck"))?;
        card.tags = self.tags_for_card(card_id)?;
        Ok(card)
    }

    pub fn update_card(
        &self,
        deck_id: i64,
        card_id: i64,
        question: Option<&str>,
        answer: Option<&str>,
        extra: Option<&str>,
        choices: Option<&[String]>,
        correct_index: Option<i64>,
        tags: Option<&[String]>,
    ) -> Result<(), String> {
        let mut sets = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(q) = question {
            sets.push("question = ?");
            args.push(Box::new(q.to_string()));
        }
        if let Some(a) = answer {
            sets.push("answer = ?");
            args.push(Box::new(a.to_string()));
        }
        if let Some(e) = extra {
            sets.push("extra = ?");
            let val: Option<String> = if e.is_empty() {
                None
            } else {
                Some(e.to_string())
            };
            args.push(Box::new(val));
        }
        if let Some(c) = choices {
            sets.push("choices = ?");
            args.push(Box::new(encode_choices(c)));
        }
        if let Some(ci) = correct_index {
            sets.push("correct_index = ?");
            args.push(Box::new(ci));
        }

        if !sets.is_empty() {
            args.push(Box::new(deck_id));
            args.push(Box::new(card_id));
            let query = format!(
                "UPDATE cards SET {}, updated_at = CURRENT_TIMESTAMP WHERE deck_id = ? AND id = ?",
                sets.join(", ")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> =
                args.iter().map(|a| a.as_ref()).collect();
            let changes = self
                .db
                .execute(&query, params.as_slice())
                .map_err(|e| e.to_string())?;
            if changes == 0 {
                return Err(format!("card {card_id} not found in deck"));
            }
        } else if tags.is_some() {
            self.ensure_card(deck_id, card_id)?;
        }

        if let Some(t) = tags {
            self.replace_card_tags(card_id, t)?;
        }
        Ok(())
    }

    pub fn delete_card(&self, deck_id: i64, card_id: i64) -> Result<(), String> {
        let changes = self
            .db
            .execute(
                "DELETE FROM cards WHERE deck_id = ?1 AND id = ?2",
                params![deck_id, card_id],
            )
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("card {card_id} not found in deck"));
        }
        Ok(())
    }

    fn ensure_card(&self, deck_id: i64, card_id: i64) -> Result<(), String> {
        let mut stmt = self
            .db
            .prepare("SELECT 1 FROM cards WHERE deck_id = ?1 AND id = ?2")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![deck_id, card_id], |_| Ok(()))
            .map_err(|_| format!("card {card_id} not found in deck"))
    }

    fn tags_for_card(&self, card_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT tag FROM card_tags WHERE card_id = ?1 ORDER BY tag")
            .map_err(|e| e.to_string())?;
        let tags = stmt
            .query_map(params![card_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tags)
    }

    fn tags_for_cards(&self, card_ids: &[i64]) -> Result<HashMap<i64, Vec<String>>, String> {
        if card_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = (1..=card_ids.len()).map(|i| format!("?{i}")).collect();
        let query = format!(
            "SELECT card_id, tag FROM card_tags WHERE card_id IN ({}) ORDER BY card_id, tag",
            placeholders.join(",")
        );
        let mut stmt = self.db.prepare(&query).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::types::ToSql> = card_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut map: HashMap<i64, Vec<String>> = HashMap::new();
        for r in rows {
            let (card_id, tag) = r.map_err(|e| e.to_string())?;
            map.entry(card_id).or_default().push(tag);
        }
        Ok(map)
    }

    // --- Scenario CRUD ---

    pub fn create_scenario(
        &self,
        name: &str,
        description: &str,
        repo_path: &str,
        skill_ids: &[i64],
    ) -> Result<i64, String> {
        let desc: Option<&str> = if description.is_empty() {
            None
        } else {
            Some(description)
        };
        let repo: Option<&str> = if repo_path.is_empty() {
            None
        } else {
            Some(repo_path)
        };
        self.db
            .execute(
                "INSERT INTO scenarios(name, description, repo_path) VALUES(?1, ?2, ?3)",
                params![name, desc, repo],
            )
            .map_err(|e| e.to_string())?;
        let id = self.db.last_insert_rowid();
        for &sid in skill_ids {
            self.db
                .execute(
                    "INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?1, ?2)",
                    params![id, sid],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(id)
    }

    pub fn list_scenarios(&self, status: &str) -> Result<Vec<Scenario>, String> {
        let mut scenarios = if status.is_empty() {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                            status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
                     FROM scenarios ORDER BY name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], scenario_from_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        } else {
            let mut stmt = self
                .db
                .prepare(
                    "SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                            status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
                     FROM scenarios WHERE status = ?1 ORDER BY name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![status], scenario_from_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for sc in &mut scenarios {
            sc.skills = self.skills_for_scenario(sc.id)?;
        }
        Ok(scenarios)
    }

    pub fn get_scenario(&self, id: i64) -> Result<Scenario, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, name, COALESCE(description,'') as description, COALESCE(repo_path,'') as repo_path,
                        status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
                 FROM scenarios WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut sc: Scenario = stmt
            .query_row(params![id], scenario_from_row)
            .map_err(|_| format!("scenario {id} not found"))?;
        sc.skills = self.skills_for_scenario(id)?;
        Ok(sc)
    }

    pub fn get_scenario_detail(&self, id: i64) -> Result<ScenarioDetail, String> {
        let scenario = self.get_scenario(id)?;
        self.build_scenario_detail(scenario)
    }

    pub fn list_scenario_steps(&self, scenario_id: i64) -> Result<Vec<ScenarioStep>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, scenario_id, position, title, COALESCE(description,'') as description,
                        status, created_at, updated_at, COALESCE(completed_at,'') as completed_at
                 FROM scenario_steps
                 WHERE scenario_id = ?1
                 ORDER BY position ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let steps = stmt
            .query_map(params![scenario_id], scenario_step_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(steps)
    }

    pub fn update_scenario(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<&str>,
        repo_path: Option<&str>,
        status: Option<&str>,
    ) -> Result<(), String> {
        let mut sets = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(n) = name {
            sets.push("name = ?");
            args.push(Box::new(n.to_string()));
        }
        if let Some(d) = description {
            sets.push("description = ?");
            let val: Option<String> = if d.is_empty() {
                None
            } else {
                Some(d.to_string())
            };
            args.push(Box::new(val));
        }
        if let Some(r) = repo_path {
            sets.push("repo_path = ?");
            let val: Option<String> = if r.is_empty() {
                None
            } else {
                Some(r.to_string())
            };
            args.push(Box::new(val));
        }
        if let Some(s) = status {
            sets.push("status = ?");
            args.push(Box::new(s.to_string()));
            if s == "completed" {
                sets.push("completed_at = CURRENT_TIMESTAMP");
            }
        }
        if sets.is_empty() {
            return Ok(());
        }
        args.push(Box::new(id));
        let query = format!("UPDATE scenarios SET {} WHERE id = ?", sets.join(", "));
        let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|a| a.as_ref()).collect();
        let changes = self
            .db
            .execute(&query, params.as_slice())
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("scenario {id} not found"));
        }
        Ok(())
    }

    pub fn create_scenario_step(
        &self,
        scenario_id: i64,
        title: &str,
        description: &str,
        position: Option<i64>,
        status: &str,
    ) -> Result<i64, String> {
        validate_step_status(status)?;
        self.with_transaction(|st| {
            st.ensure_scenario_exists(scenario_id)?;

            let mut step_ids = st.scenario_step_ids(scenario_id)?;
            let insert_position = position.unwrap_or(step_ids.len() as i64 + 1);
            if insert_position < 1 || insert_position > step_ids.len() as i64 + 1 {
                return Err(format!(
                    "position must be between 1 and {}",
                    step_ids.len() + 1
                ));
            }

            let desc: Option<&str> = if description.is_empty() {
                None
            } else {
                Some(description)
            };

            st.db
                .execute(
                    "INSERT INTO scenario_steps(scenario_id, position, title, description, status, completed_at)
                     VALUES(?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END)",
                    params![scenario_id, step_ids.len() as i64 + 1, title, desc, status],
                )
                .map_err(|e| e.to_string())?;
            let step_id = st.db.last_insert_rowid();

            step_ids.insert((insert_position - 1) as usize, step_id);
            st.renumber_scenario_steps(&step_ids)?;

            Ok(step_id)
        })
    }

    pub fn delete_scenario(&self, id: i64) -> Result<(), String> {
        let changes = self
            .db
            .execute("DELETE FROM scenarios WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("scenario {id} not found"));
        }
        Ok(())
    }

    pub fn update_scenario_step(
        &self,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        status: Option<&str>,
    ) -> Result<(), String> {
        if let Some(s) = status {
            validate_step_status(s)?;
        }

        let mut sets = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(t) = title {
            sets.push("title = ?");
            args.push(Box::new(t.to_string()));
        }
        if let Some(d) = description {
            sets.push("description = ?");
            let value: Option<String> = if d.is_empty() {
                None
            } else {
                Some(d.to_string())
            };
            args.push(Box::new(value));
        }
        if let Some(s) = status {
            sets.push("status = ?");
            args.push(Box::new(s.to_string()));
            if s == "completed" {
                sets.push("completed_at = CURRENT_TIMESTAMP");
            } else {
                sets.push("completed_at = NULL");
            }
        }
        if sets.is_empty() {
            return Ok(());
        }

        args.push(Box::new(id));
        let query = format!("UPDATE scenario_steps SET {} WHERE id = ?", sets.join(", "));
        let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|a| a.as_ref()).collect();
        let changes = self
            .db
            .execute(&query, params.as_slice())
            .map_err(|e| e.to_string())?;
        if changes == 0 {
            return Err(format!("scenario step {id} not found"));
        }
        Ok(())
    }

    pub fn move_scenario_step(&self, id: i64, position: i64) -> Result<(), String> {
        if position < 1 {
            return Err("position must be at least 1".into());
        }

        self.with_transaction(|st| {
            let (scenario_id, current_position): (i64, i64) = st
                .db
                .query_row(
                    "SELECT scenario_id, position FROM scenario_steps WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| format!("scenario step {id} not found"))?;

            let mut step_ids = st.scenario_step_ids(scenario_id)?;
            let max_position = step_ids.len() as i64;
            if position > max_position {
                return Err(format!("position must be between 1 and {max_position}"));
            }
            if position == current_position {
                return Ok(());
            }

            let current_index = (current_position - 1) as usize;
            let step_id = step_ids.remove(current_index);
            step_ids.insert((position - 1) as usize, step_id);
            st.renumber_scenario_steps(&step_ids)?;
            Ok(())
        })
    }

    pub fn delete_scenario_step(&self, id: i64) -> Result<(), String> {
        self.with_transaction(|st| {
            let scenario_id: i64 = st
                .db
                .query_row(
                    "SELECT scenario_id FROM scenario_steps WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|_| format!("scenario step {id} not found"))?;

            st.db
                .execute("DELETE FROM scenario_steps WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            let step_ids = st.scenario_step_ids(scenario_id)?;
            st.renumber_scenario_steps(&step_ids)?;
            Ok(())
        })
    }

    fn skills_for_scenario(&self, scenario_id: i64) -> Result<Vec<Skill>, String> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT sk.id, sk.parent_id, sk.name, COALESCE(sk.description,'') as description, sk.level, sk.created_at, sk.updated_at
                 FROM scenario_skills ss
                 JOIN skills sk ON sk.id = ss.skill_id
                 WHERE ss.scenario_id = ?1
                 ORDER BY sk.name",
            )
            .map_err(|e| e.to_string())?;
        let skills = stmt
            .query_map(params![scenario_id], |row| {
                Ok(Skill {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    level: row.get(4)?,
                    children: vec![],
                    decks: vec![],
                    scenarios: vec![],
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(skills)
    }

    // --- Junction tables ---

    pub fn link_deck_skill(&self, deck_id: i64, skill_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?1, ?2)",
                params![deck_id, skill_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn unlink_deck_skill(&self, deck_id: i64, skill_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM deck_skills WHERE deck_id = ?1 AND skill_id = ?2",
                params![deck_id, skill_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn link_scenario_skill(&self, scenario_id: i64, skill_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?1, ?2)",
                params![scenario_id, skill_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn unlink_scenario_skill(&self, scenario_id: i64, skill_id: i64) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM scenario_skills WHERE scenario_id = ?1 AND skill_id = ?2",
                params![scenario_id, skill_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Review by skill ---

    pub fn cards_for_skill(&self, skill_id: i64, limit: i64) -> Result<Vec<Card>, String> {
        let limit = if limit <= 0 { 50 } else { limit };
        let mut skill_ids = self.descendant_skill_ids(skill_id)?;
        skill_ids.push(skill_id);

        let placeholders: Vec<String> = (1..=skill_ids.len()).map(|i| format!("?{i}")).collect();
        let query = format!(
            "SELECT DISTINCT deck_id FROM deck_skills WHERE skill_id IN ({})",
            placeholders.join(",")
        );
        let mut stmt = self.db.prepare(&query).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::types::ToSql> = skill_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let deck_ids: Vec<i64> = stmt
            .query_map(params.as_slice(), |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if deck_ids.is_empty() {
            return Ok(vec![]);
        }

        let d_placeholders: Vec<String> = (1..=deck_ids.len()).map(|i| format!("?{i}")).collect();
        let cquery = format!(
            "SELECT id, deck_id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
             FROM cards WHERE deck_id IN ({}) ORDER BY id LIMIT ?{}",
            d_placeholders.join(","),
            deck_ids.len() + 1
        );
        let mut cstmt = self.db.prepare(&cquery).map_err(|e| e.to_string())?;
        let mut cparams: Vec<Box<dyn rusqlite::types::ToSql>> = deck_ids
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        cparams.push(Box::new(limit));
        let cparams_ref: Vec<&dyn rusqlite::types::ToSql> =
            cparams.iter().map(|p| p.as_ref()).collect();
        let mut cards: Vec<Card> = cstmt
            .query_map(cparams_ref.as_slice(), |row| Ok(scan_card(row)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let card_ids: Vec<i64> = cards.iter().map(|c| c.id).collect();
        let tags_by_card = self.tags_for_cards(&card_ids)?;
        for card in &mut cards {
            if let Some(tags) = tags_by_card.get(&card.id) {
                card.tags = tags.clone();
            }
        }
        Ok(cards)
    }

    fn descendant_skill_ids(&self, parent_id: i64) -> Result<Vec<i64>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT id FROM skills WHERE parent_id = ?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt
            .query_map(params![parent_id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut all_desc = ids.clone();
        for child_id in &ids {
            all_desc.extend(self.descendant_skill_ids(*child_id)?);
        }
        Ok(all_desc)
    }

    // --- Import from quiz ---

    pub fn import_from_quiz(&self, quiz_db_path: &str) -> Result<(i64, i64), String> {
        let quiz_db =
            Connection::open_with_flags(quiz_db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("open quiz db: {e}"))?;

        let mut qstmt = quiz_db
            .prepare(
                "SELECT id, name, COALESCE(description,'') as description FROM decks ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let qdecks: Vec<(i64, String, String)> = qstmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let existing_decks = self.list_decks()?;
        let existing_names: HashSet<String> =
            existing_decks.iter().map(|d| d.name.clone()).collect();

        let mut decks_imported: i64 = 0;
        let mut cards_imported: i64 = 0;

        for (qd_id, qd_name, qd_desc) in &qdecks {
            if existing_names.contains(qd_name) {
                continue;
            }

            self.db
                .execute(
                    "INSERT INTO decks(name, description) VALUES(?1, ?2)",
                    params![qd_name, qd_desc],
                )
                .map_err(|e| e.to_string())?;
            let new_deck_id = self.db.last_insert_rowid();
            decks_imported += 1;

            let mut cstmt = quiz_db
                .prepare(
                    "SELECT id, question, answer, COALESCE(extra,'') as extra, choices, correct_index
                     FROM cards WHERE deck_id = ?1 ORDER BY id",
                )
                .map_err(|e| e.to_string())?;
            let qcards: Vec<(i64, String, String, String, Option<String>, Option<i64>)> = cstmt
                .query_map(params![qd_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            for (qc_id, question, answer, extra, choices_raw, correct_index) in &qcards {
                let choices = decode_choices(choices_raw.as_deref());
                let choices_value = encode_choices(&choices);
                let extra_value: Option<&str> = if extra.is_empty() { None } else { Some(extra) };

                self.db
                    .execute(
                        "INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                        params![new_deck_id, question, answer, extra_value, choices_value, correct_index],
                    )
                    .map_err(|e| e.to_string())?;
                let new_card_id = self.db.last_insert_rowid();

                let mut tstmt = quiz_db
                    .prepare("SELECT tag FROM card_tags WHERE card_id = ?1 ORDER BY tag")
                    .map_err(|e| e.to_string())?;
                let qtags: Vec<String> = tstmt
                    .query_map(params![qc_id], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;

                for tag in &qtags {
                    self.db
                        .execute(
                            "INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?1, ?2)",
                            params![new_card_id, tag],
                        )
                        .map_err(|e| e.to_string())?;
                }

                cards_imported += 1;
            }
        }

        Ok((decks_imported, cards_imported))
    }
}

// --- Helpers ---

fn scan_card(row: &rusqlite::Row) -> Card {
    let choices_raw: Option<String> = row.get(5).unwrap_or(None);
    Card {
        id: row.get(0).unwrap_or(0),
        deck_id: row.get(1).unwrap_or(0),
        question: row.get(2).unwrap_or_default(),
        answer: row.get(3).unwrap_or_default(),
        extra: row.get(4).unwrap_or_default(),
        choices: decode_choices(choices_raw.as_deref()),
        correct_index: row.get(6).unwrap_or(None),
        tags: vec![],
    }
}

fn build_tree(all: Vec<Skill>) -> Vec<Skill> {
    let mut by_id: HashMap<i64, Skill> = HashMap::new();
    for sk in all {
        by_id.insert(sk.id, sk);
    }

    let ids: Vec<i64> = by_id.keys().copied().collect();
    let mut child_map: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut root_ids: Vec<i64> = Vec::new();

    for &id in &ids {
        let parent_id = by_id[&id].parent_id;
        if let Some(pid) = parent_id {
            if by_id.contains_key(&pid) {
                child_map.entry(pid).or_default().push(id);
            } else {
                root_ids.push(id);
            }
        } else {
            root_ids.push(id);
        }
    }

    // Sort children by name
    for children in child_map.values_mut() {
        children.sort_by(|a, b| {
            let a_name = &by_id[a].name;
            let b_name = &by_id[b].name;
            a_name.cmp(b_name)
        });
    }
    root_ids.sort_by(|a, b| by_id[a].name.cmp(&by_id[b].name));

    fn build_subtree(
        id: i64,
        by_id: &mut HashMap<i64, Skill>,
        child_map: &HashMap<i64, Vec<i64>>,
    ) -> Skill {
        let child_ids = child_map.get(&id).cloned().unwrap_or_default();
        let children: Vec<Skill> = child_ids
            .iter()
            .map(|&cid| build_subtree(cid, by_id, child_map))
            .collect();
        let mut skill = by_id.remove(&id).unwrap();
        skill.children = children;
        skill
    }

    root_ids
        .iter()
        .map(|&id| build_subtree(id, &mut by_id, &child_map))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> Store {
        let db = Connection::open_in_memory().unwrap();
        migrate(&db).unwrap();
        Store {
            db,
            path: PathBuf::from(":memory:"),
        }
    }

    #[test]
    fn scenario_steps_insert_in_order_and_report_progress() {
        let st = test_store();
        let scenario_id = st.create_scenario("Rust lesson", "", "", &[]).unwrap();

        st.create_scenario_step(scenario_id, "Step 1", "", None, "planned")
            .unwrap();
        st.create_scenario_step(scenario_id, "Step 3", "", None, "blocked")
            .unwrap();
        st.create_scenario_step(scenario_id, "Step 2", "", Some(2), "in_progress")
            .unwrap();

        let steps = st.list_scenario_steps(scenario_id).unwrap();
        let titles: Vec<&str> = steps.iter().map(|s| s.title.as_str()).collect();
        let positions: Vec<i64> = steps.iter().map(|s| s.position).collect();

        assert_eq!(titles, vec!["Step 1", "Step 2", "Step 3"]);
        assert_eq!(positions, vec![1, 2, 3]);

        let detail = st.get_scenario_detail(scenario_id).unwrap();
        assert_eq!(detail.progress.total_steps, 3);
        assert_eq!(detail.progress.planned_steps, 1);
        assert_eq!(detail.progress.in_progress_steps, 1);
        assert_eq!(detail.progress.blocked_steps, 1);
    }

    #[test]
    fn scenario_steps_move_update_and_delete_renumber() {
        let st = test_store();
        let scenario_id = st.create_scenario("CLI project", "", "", &[]).unwrap();

        let step_a = st
            .create_scenario_step(scenario_id, "First", "", None, "planned")
            .unwrap();
        let step_b = st
            .create_scenario_step(scenario_id, "Second", "", None, "planned")
            .unwrap();
        let step_c = st
            .create_scenario_step(scenario_id, "Third", "", None, "planned")
            .unwrap();

        st.move_scenario_step(step_c, 1).unwrap();
        let steps = st.list_scenario_steps(scenario_id).unwrap();
        let titles: Vec<&str> = steps.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["Third", "First", "Second"]);

        st.update_scenario_step(step_b, None, None, Some("completed"))
            .unwrap();
        let steps = st.list_scenario_steps(scenario_id).unwrap();
        let second = steps.iter().find(|s| s.id == step_b).unwrap();
        assert_eq!(second.status, "completed");
        assert!(!second.completed_at.is_empty());

        st.update_scenario_step(step_b, None, None, Some("planned"))
            .unwrap();
        let steps = st.list_scenario_steps(scenario_id).unwrap();
        let second = steps.iter().find(|s| s.id == step_b).unwrap();
        assert_eq!(second.status, "planned");
        assert!(second.completed_at.is_empty());

        st.delete_scenario_step(step_a).unwrap();
        let steps = st.list_scenario_steps(scenario_id).unwrap();
        let positions: Vec<i64> = steps.iter().map(|s| s.position).collect();
        let ids: Vec<i64> = steps.iter().map(|s| s.id).collect();
        assert_eq!(positions, vec![1, 2]);
        assert_eq!(ids, vec![step_c, step_b]);
    }

    #[test]
    fn depth_two_skills_do_not_store_levels() {
        let st = test_store();

        let root_id = st.create_skill("Rust", "", None, Some(1)).unwrap();
        let child_id = st
            .create_skill("Ownership", "", Some(root_id), Some(2))
            .unwrap();
        let grandchild_id = st
            .create_skill("Borrow checking", "", Some(child_id), None)
            .unwrap();

        let root = st.get_skill(root_id).unwrap();
        let child = st.get_skill(child_id).unwrap();
        let grandchild = st.get_skill(grandchild_id).unwrap();

        assert_eq!(root.level, Some(1));
        assert_eq!(child.level, Some(2));
        assert_eq!(grandchild.level, None);

        let err = st
            .create_skill("Lifetimes", "", Some(child_id), Some(1))
            .unwrap_err();
        assert!(err.contains("depth 2+"));

        let err = st
            .update_skill(grandchild_id, None, None, Some(3))
            .unwrap_err();
        assert!(err.contains("depth 2+"));
    }

    #[test]
    fn scoped_context_returns_selected_subtree_and_relevant_active_scenarios() {
        let st = test_store();

        let rust_id = st.create_skill("Rust", "", None, Some(1)).unwrap();
        let concurrency_id = st
            .create_skill("Concurrency", "", Some(rust_id), Some(1))
            .unwrap();
        let async_id = st
            .create_skill("Async", "", Some(concurrency_id), None)
            .unwrap();
        let driving_id = st.create_skill("Driving", "", None, Some(1)).unwrap();

        let rust_scenario = st
            .create_scenario("Build async worker", "", "", &[concurrency_id])
            .unwrap();
        let _driving_scenario = st
            .create_scenario("Practice parking", "", "", &[driving_id])
            .unwrap();

        st.update_scenario(rust_scenario, None, None, None, Some("in_progress"))
            .unwrap();

        let ctx = st.scoped_context(rust_id).unwrap();
        assert_eq!(ctx.skills.len(), 1);
        assert_eq!(ctx.skills[0].id, rust_id);
        assert_eq!(ctx.skills[0].children.len(), 1);
        assert_eq!(ctx.skills[0].children[0].id, concurrency_id);
        assert_eq!(ctx.skills[0].children[0].children.len(), 1);
        assert_eq!(ctx.skills[0].children[0].children[0].id, async_id);

        let scenario_names: Vec<&str> = ctx
            .active_scenarios
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(scenario_names, vec!["Build async worker"]);
    }
}
