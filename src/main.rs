mod store;
mod tui;
mod tui_helpers;

use std::collections::HashMap;
use std::fs;
use std::process;

use clap::{Parser, Subcommand};
use cli_core::{db_path, json, resolve_skills_dir, install, InstallOptions};
use serde::Deserialize;

use store::{Card, Deck, Store, validate_level, validate_status};
use tui_helpers::{level_bar, level_label};

// --- CLI ---

#[derive(Parser)]
#[command(name = "skill-tree", about = "Unified learning CLI: skill tree + quiz decks + scenarios")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Full context dump (skill tree + scenarios)
    Context {
        #[arg(long)]
        json: bool,
    },
    /// Manage skills
    Skill {
        #[command(subcommand)]
        command: SkillCommands,
    },
    /// Manage scenarios
    Scenario {
        #[command(subcommand)]
        command: ScenarioCommands,
    },
    /// Manage decks
    Deck {
        #[command(subcommand)]
        command: DeckCommands,
    },
    /// Manage cards
    Card {
        #[command(subcommand)]
        command: CardCommands,
    },
    /// Start review session
    Review {
        /// Deck name (positional)
        deck_positional: Option<String>,
        #[arg(short, long, default_value = "auto")]
        mode: String,
        #[arg(short, long, default_value = "200")]
        limit: i64,
        #[arg(long)]
        deck: Option<String>,
        #[arg(long)]
        skill: Option<String>,
    },
    /// Interactive skill tree TUI
    Tree,
    /// Import data from quiz CLI
    Import {
        #[arg(long)]
        from_quiz: bool,
    },
}

#[derive(Subcommand)]
enum SkillCommands {
    /// Add skill
    Add {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "")]
        description: String,
        #[arg(long, default_value = "0")]
        parent_id: i64,
        #[arg(long, default_value = "0")]
        level: i64,
    },
    /// List skills
    List {
        #[arg(long)]
        tree: bool,
        #[arg(long, default_value = "0")]
        parent_id: i64,
        #[arg(long)]
        json: bool,
    },
    /// Show skill
    Show {
        #[arg(long)]
        id: i64,
        #[arg(long)]
        json: bool,
    },
    /// Update skill
    Update {
        #[arg(long)]
        id: i64,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        level: Option<i64>,
    },
    /// Delete skill
    Delete {
        #[arg(long)]
        id: i64,
    },
    /// Install skill
    Install {
        #[arg(long)]
        dest: Option<String>,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        link: bool,
    },
}

#[derive(Subcommand)]
enum ScenarioCommands {
    /// Add scenario
    Add {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "")]
        description: String,
        #[arg(long, default_value = "")]
        repo: String,
        #[arg(long, num_args = 1..)]
        skill_id: Vec<i64>,
    },
    /// List scenarios
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Show scenario
    Show {
        #[arg(long)]
        id: i64,
        #[arg(long)]
        json: bool,
    },
    /// Update scenario
    Update {
        #[arg(long)]
        id: i64,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        status: Option<String>,
    },
    /// Delete scenario
    Delete {
        #[arg(long)]
        id: i64,
    },
    /// Link scenario to skill
    Link {
        #[arg(long)]
        scenario_id: i64,
        #[arg(long)]
        skill_id: i64,
    },
    /// Unlink scenario from skill
    Unlink {
        #[arg(long)]
        scenario_id: i64,
        #[arg(long)]
        skill_id: i64,
    },
}

#[derive(Subcommand)]
enum DeckCommands {
    /// Create deck
    Create {
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long, default_value = "")]
        description: String,
        #[arg(long)]
        data: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long, num_args = 1..)]
        skill_id: Vec<i64>,
    },
    /// List decks
    List {
        #[arg(long)]
        json: bool,
    },
    /// Delete deck
    Delete {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
    },
    /// Link deck to skill
    Link {
        #[arg(long)]
        deck_id: i64,
        #[arg(long)]
        skill_id: i64,
    },
    /// Unlink deck from skill
    Unlink {
        #[arg(long)]
        deck_id: i64,
        #[arg(long)]
        skill_id: i64,
    },
    /// Reset coverage for a deck
    ResetCoverage {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
    },
    /// Mark all cards in a deck as covered
    CompleteCoverage {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
    },
}

#[derive(Subcommand)]
enum CardCommands {
    /// List cards in a deck
    List {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long, default_value = "50")]
        limit: i64,
    },
    /// Add card
    Add {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long)]
        question: Option<String>,
        #[arg(long)]
        answer: Option<String>,
        #[arg(long)]
        extra: Option<String>,
        #[arg(long, num_args = 1..)]
        choice: Vec<String>,
        #[arg(long, default_value = "0")]
        correct_index: i64,
        #[arg(long, num_args = 1..)]
        tag: Vec<String>,
        #[arg(long)]
        data: Option<String>,
        #[arg(long)]
        file: Option<String>,
    },
    /// Show card
    Show {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long)]
        card_id: i64,
    },
    /// Delete card(s)
    Delete {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long)]
        card_id: Option<i64>,
        #[arg(long)]
        card_ids: Option<String>,
    },
    /// Update card
    Update {
        #[arg(long)]
        deck_id: Option<i64>,
        #[arg(long)]
        deck_name: Option<String>,
        #[arg(long)]
        card_id: i64,
        #[arg(long)]
        question: Option<String>,
        #[arg(long)]
        answer: Option<String>,
        #[arg(long)]
        extra: Option<String>,
        #[arg(long, num_args = 1..)]
        choice: Option<Vec<String>>,
        #[arg(long)]
        correct_index: Option<i64>,
        #[arg(long, num_args = 1..)]
        tag: Option<Vec<String>>,
    },
}

// --- JSON input types ---

#[derive(Deserialize)]
struct RawCardInput {
    question: String,
    answer: String,
    extra: Option<String>,
    choices: Option<Vec<String>>,
    correct_index: Option<i64>,
    #[serde(rename = "correctIndex")]
    correct_index_alt: Option<i64>,
    tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct DeckPayload {
    name: String,
    description: Option<String>,
    cards: Option<Vec<RawCardInput>>,
}

// --- Helpers ---

fn resolve_deck_id(deck_id: Option<i64>, deck_name: Option<&str>) -> Result<i64, String> {
    let did = deck_id.unwrap_or(0);
    if did > 0 {
        return Ok(did);
    }
    match deck_name {
        Some(name) if !name.is_empty() => {
            let st = Store::open()?;
            st.get_deck_by_name(name).map(|d| d.id)
        }
        _ => Err("either --deck-id or --deck-name is required".into()),
    }
}

fn read_payload(data: Option<&str>, file: Option<&str>) -> Result<String, String> {
    match (data, file) {
        (Some(_), Some(_)) => Err("specify only one of --data or --file".into()),
        (Some(d), None) => Ok(d.to_string()),
        (None, Some(f)) => fs::read_to_string(f).map_err(|e| format!("read {f}: {e}")),
        (None, None) => Err("missing input payload".into()),
    }
}

fn normalize_card(input: RawCardInput, index: usize) -> Result<Card, String> {
    if input.question.trim().is_empty() {
        return Err(format!("card {}: question is required", index + 1));
    }
    if input.answer.trim().is_empty() {
        return Err(format!("card {}: answer is required", index + 1));
    }
    let choices = input.choices.unwrap_or_default();
    let mut correct = input.correct_index.or(input.correct_index_alt);
    if choices.is_empty() {
        correct = None;
    }
    if let Some(ci) = correct {
        if ci < 0 || ci >= choices.len() as i64 {
            return Err(format!("card {}: correct index out of range", index + 1));
        }
    }
    if correct.is_none() && !choices.is_empty() {
        correct = Some(0);
    }
    Ok(Card {
        id: 0,
        deck_id: 0,
        question: input.question,
        answer: input.answer,
        extra: input.extra.unwrap_or_default(),
        choices,
        correct_index: correct,
        tags: input.tags.unwrap_or_default(),
    })
}

fn parse_card_ids(raw: &str) -> Result<Vec<i64>, String> {
    let mut out = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if part.contains('-') {
            let pieces: Vec<&str> = part.splitn(2, '-').collect();
            let start: i64 = pieces[0]
                .trim()
                .parse()
                .map_err(|_| format!("invalid card id range \"{part}\""))?;
            let end: i64 = pieces[1]
                .trim()
                .parse()
                .map_err(|_| format!("invalid card id range \"{part}\""))?;
            if end < start {
                return Err(format!("invalid card id range \"{part}\""));
            }
            for i in start..=end {
                out.push(i);
            }
        } else {
            let id: i64 = part
                .parse()
                .map_err(|_| format!("invalid card id \"{part}\""))?;
            out.push(id);
        }
    }
    Ok(out)
}

fn parse_mode_with_fallback(raw: &str) -> String {
    let mode = raw.trim().to_lowercase();
    match mode.as_str() {
        "flashcard" | "mcq" | "auto" => mode,
        _ => "auto".into(),
    }
}

fn coverage_text(covered: i64, total: i64) -> String {
    if total == 0 {
        "--".to_string()
    } else {
        format!("{}%", (covered * 100) / total)
    }
}

fn format_updated_at(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return value.to_string();
    }
    // Try to normalize: take first 16 chars, replace T with space
    let normalized = value.replace('T', " ");
    if normalized.len() >= 16 {
        normalized[..16].to_string()
    } else {
        normalized
    }
}

fn print_skill_links(
    decks: &[Deck],
    scenarios: &[store::Scenario],
    indent: &str,
) {
    if !decks.is_empty() {
        println!("{indent}Decks:");
        for d in decks {
            println!(
                "{indent}  {} ({} cards, {})",
                d.name,
                d.card_count,
                coverage_text(d.covered_count, d.card_count)
            );
        }
    }
    if !scenarios.is_empty() {
        println!("{indent}Scenarios:");
        for sc in scenarios {
            println!("{indent}  {} [{}]", sc.name, sc.status);
        }
    }
    if decks.is_empty() && scenarios.is_empty() {
        println!("{indent}No decks or scenarios linked.");
    }
}

fn print_skill_tree(skills: &[store::Skill], depth: usize) {
    for s in skills {
        let indent = "  ".repeat(depth);
        println!(
            "{indent}{} {} {}/5 {}",
            s.name,
            level_bar(s.level),
            s.level,
            level_label(s.level)
        );
        if !s.children.is_empty() {
            print_skill_tree(&s.children, depth + 1);
        }
    }
}

fn find_skill_by_name<'a>(
    skills: &'a [store::Skill],
    name: &str,
) -> Option<&'a store::Skill> {
    for s in skills {
        if s.name.eq_ignore_ascii_case(name) {
            return Some(s);
        }
        if let Some(found) = find_skill_by_name(&s.children, name) {
            return Some(found);
        }
    }
    None
}

// --- Main ---

fn main() {
    let cli = Cli::parse();

    if let Err(e) = run(cli) {
        eprintln!("{e}");
        process::exit(1);
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        None => run_tree_command(),
        Some(cmd) => match cmd {
            Commands::Context { .. } => {
                let st = Store::open()?;
                let ctx = st.full_context()?;
                json(&ctx);
                Ok(())
            }
            Commands::Skill { command } => run_skill(command),
            Commands::Scenario { command } => run_scenario(command),
            Commands::Deck { command } => run_deck(command),
            Commands::Card { command } => run_card(command),
            Commands::Review {
                deck_positional,
                mode,
                limit,
                deck,
                skill,
            } => {
                if let Some(skill_name) = skill {
                    return run_skill_review(&skill_name, &mode, limit);
                }
                let mut deck_query = deck.unwrap_or_default().trim().to_string();
                if let Some(pos) = deck_positional {
                    if !deck_query.is_empty() {
                        return Err("specify either positional [deck] or --deck, not both".into());
                    }
                    deck_query = pos.trim().to_string();
                }
                run_review_session(&deck_query, &mode, limit)
            }
            Commands::Tree => run_tree_command(),
            Commands::Import { from_quiz } => {
                if !from_quiz {
                    return Err("--from-quiz is required".into());
                }
                let quiz_db_path = db_path("quiz", "quiz.db");
                let st = Store::open()?;
                let (decks, cards) = st.import_from_quiz(quiz_db_path.to_str().unwrap())?;
                println!(
                    "Imported {decks} decks with {cards} cards from {}",
                    quiz_db_path.display()
                );
                Ok(())
            }
        },
    }
}

fn run_skill(cmd: SkillCommands) -> Result<(), String> {
    match cmd {
        SkillCommands::Add {
            name,
            description,
            parent_id,
            level,
        } => {
            validate_level(level)?;
            let pid = if parent_id > 0 { Some(parent_id) } else { None };
            let st = Store::open()?;
            let id = st.create_skill(&name, &description, pid, level)?;
            println!("Created skill {id}: {name}");
            Ok(())
        }
        SkillCommands::List {
            tree,
            parent_id,
            json: json_flag,
        } => {
            let st = Store::open()?;
            if tree || json_flag {
                let skills = st.skill_tree()?;
                if json_flag {
                    json(&skills);
                    return Ok(());
                }
                print_skill_tree(&skills, 0);
                return Ok(());
            }
            let pid = if parent_id > 0 {
                Some(parent_id)
            } else {
                None
            };
            let skills = st.list_skills(pid)?;
            for s in &skills {
                println!("{}\t{}\t{}/5", s.id, s.name, s.level);
            }
            Ok(())
        }
        SkillCommands::Show { id, json: json_flag } => {
            let st = Store::open()?;
            let skill = st.get_skill(id)?;
            if json_flag {
                json(&skill);
                return Ok(());
            }
            println!(
                "ID: {}\nName: {}\nLevel: {}/5 {}\nDescription: {}",
                skill.id,
                skill.name,
                skill.level,
                level_label(skill.level),
                skill.description
            );
            print_skill_links(&skill.decks, &skill.scenarios, "");
            for child in &skill.children {
                println!(
                    "\n{} ({}/5 {})",
                    child.name,
                    child.level,
                    level_label(child.level)
                );
                print_skill_links(&child.decks, &child.scenarios, "  ");
            }
            Ok(())
        }
        SkillCommands::Update {
            id,
            name,
            description,
            level,
        } => {
            if let Some(l) = level {
                validate_level(l)?;
            }
            let st = Store::open()?;
            st.update_skill(id, name.as_deref(), description.as_deref(), level)?;
            println!("Updated skill {id}");
            Ok(())
        }
        SkillCommands::Delete { id } => {
            let st = Store::open()?;
            st.delete_skill(id)?;
            println!("Deleted skill {id}");
            Ok(())
        }
        SkillCommands::Install { dest, force, link } => {
            let dest_dir = resolve_skills_dir(dest.as_deref())
                .map_err(|e| e.to_string())?;
            let path = install(&InstallOptions {
                src_dir: "skills/skill-tree".into(),
                dest_dir: dest_dir.to_string_lossy().into(),
                name: Some("skill-tree".into()),
                overwrite: force,
                link,
            })
            .map_err(|e| e.to_string())?;
            println!("Installed skill to {}", path.display());
            Ok(())
        }
    }
}

fn run_scenario(cmd: ScenarioCommands) -> Result<(), String> {
    match cmd {
        ScenarioCommands::Add {
            name,
            description,
            repo,
            skill_id,
        } => {
            let st = Store::open()?;
            let id = st.create_scenario(&name, &description, &repo, &skill_id)?;
            println!("Created scenario {id}: {name}");
            Ok(())
        }
        ScenarioCommands::List { status, json: json_flag } => {
            let st = Store::open()?;
            let scenarios = st.list_scenarios(status.as_deref().unwrap_or(""))?;
            if json_flag {
                json(&scenarios);
                return Ok(());
            }
            for sc in &scenarios {
                println!("{}\t{}\t{}", sc.id, sc.name, sc.status);
            }
            Ok(())
        }
        ScenarioCommands::Show { id, json: json_flag } => {
            let st = Store::open()?;
            let sc = st.get_scenario(id)?;
            if json_flag {
                json(&sc);
                return Ok(());
            }
            println!(
                "ID: {}\nName: {}\nStatus: {}\nDescription: {}",
                sc.id, sc.name, sc.status, sc.description
            );
            if !sc.repo_path.is_empty() {
                println!("Repo: {}", sc.repo_path);
            }
            if !sc.skills.is_empty() {
                println!("Skills:");
                for s in &sc.skills {
                    println!("  {}: {}", s.id, s.name);
                }
            }
            Ok(())
        }
        ScenarioCommands::Update {
            id,
            name,
            description,
            repo,
            status,
        } => {
            if let Some(ref s) = status {
                validate_status(s)?;
            }
            let st = Store::open()?;
            st.update_scenario(
                id,
                name.as_deref(),
                description.as_deref(),
                repo.as_deref(),
                status.as_deref(),
            )?;
            println!("Updated scenario {id}");
            Ok(())
        }
        ScenarioCommands::Delete { id } => {
            let st = Store::open()?;
            st.delete_scenario(id)?;
            println!("Deleted scenario {id}");
            Ok(())
        }
        ScenarioCommands::Link {
            scenario_id,
            skill_id,
        } => {
            let st = Store::open()?;
            st.link_scenario_skill(scenario_id, skill_id)?;
            println!("Linked scenario {scenario_id} to skill {skill_id}");
            Ok(())
        }
        ScenarioCommands::Unlink {
            scenario_id,
            skill_id,
        } => {
            let st = Store::open()?;
            st.unlink_scenario_skill(scenario_id, skill_id)?;
            println!("Unlinked scenario {scenario_id} from skill {skill_id}");
            Ok(())
        }
    }
}

fn run_deck(cmd: DeckCommands) -> Result<(), String> {
    match cmd {
        DeckCommands::Create {
            deck_name,
            description,
            data,
            file,
            skill_id,
        } => {
            let st = Store::open()?;
            if data.is_none() && file.is_none() {
                let name = deck_name.ok_or("--deck-name is required")?;
                st.create_deck_with_contents(&name, &description, &skill_id, &[])?;
                println!("Created deck: {name}");
                return Ok(());
            }
            if (data.is_some() || file.is_some()) && (deck_name.is_some() || !description.is_empty()) {
                return Err("--deck-name/--description cannot be used with --data/--file".into());
            }
            let payload = read_payload(data.as_deref(), file.as_deref())?;
            let deck_input: DeckPayload =
                serde_json::from_str(&payload).map_err(|e| format!("invalid JSON: {e}"))?;
            if deck_input.name.is_empty() {
                return Err("deck payload requires name".into());
            }
            let raw_cards = deck_input.cards.unwrap_or_default();
            let mut cards = Vec::new();
            for (idx, raw) in raw_cards.into_iter().enumerate() {
                cards.push(normalize_card(raw, idx)?);
            }
            st.create_deck_with_contents(
                &deck_input.name,
                deck_input.description.as_deref().unwrap_or(""),
                &skill_id,
                &cards,
            )?;
            if !cards.is_empty() {
                println!(
                    "Created deck: {} with {} cards",
                    deck_input.name,
                    cards.len()
                );
            } else {
                println!("Created deck: {}", deck_input.name);
            }
            Ok(())
        }
        DeckCommands::List { json: json_flag } => {
            let st = Store::open()?;
            let decks = st.list_decks()?;
            if json_flag {
                json(&decks);
                return Ok(());
            }
            for d in &decks {
                let cov = coverage_text(d.covered_count, d.card_count);
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    d.id,
                    d.name,
                    d.card_count,
                    cov,
                    format_updated_at(&d.updated_at),
                    d.description
                );
            }
            Ok(())
        }
        DeckCommands::Delete { deck_id, deck_name } => {
            let st = Store::open()?;
            let mut did = deck_id.unwrap_or(0);
            if did == 0 {
                let name = deck_name.ok_or("either --deck-id or --deck-name is required")?;
                did = st.get_deck_by_name(&name)?.id;
            }
            st.delete_deck_by_id(did)?;
            println!("Deleted deck id: {did}");
            Ok(())
        }
        DeckCommands::Link { deck_id, skill_id } => {
            let st = Store::open()?;
            st.link_deck_skill(deck_id, skill_id)?;
            println!("Linked deck {deck_id} to skill {skill_id}");
            Ok(())
        }
        DeckCommands::Unlink { deck_id, skill_id } => {
            let st = Store::open()?;
            st.unlink_deck_skill(deck_id, skill_id)?;
            println!("Unlinked deck {deck_id} from skill {skill_id}");
            Ok(())
        }
        DeckCommands::ResetCoverage { deck_id, deck_name } => {
            let st = Store::open()?;
            let mut did = deck_id.unwrap_or(0);
            if did == 0 {
                let name = deck_name.ok_or("either --deck-id or --deck-name is required")?;
                did = st.get_deck_by_name(&name)?.id;
            }
            st.reset_deck_coverage(did)?;
            println!("Reset coverage for deck {did}");
            Ok(())
        }
        DeckCommands::CompleteCoverage { deck_id, deck_name } => {
            let st = Store::open()?;
            let mut did = deck_id.unwrap_or(0);
            if did == 0 {
                let name = deck_name.ok_or("either --deck-id or --deck-name is required")?;
                did = st.get_deck_by_name(&name)?.id;
            }
            st.complete_deck_coverage(did)?;
            println!("Completed coverage for deck {did}");
            Ok(())
        }
    }
}

fn run_card(cmd: CardCommands) -> Result<(), String> {
    match cmd {
        CardCommands::List {
            deck_id,
            deck_name,
            limit,
        } => {
            let did = resolve_deck_id(deck_id, deck_name.as_deref())?;
            let st = Store::open()?;
            let cards = st.list_cards(did, limit)?;
            for c in &cards {
                println!("{}\t{}", c.id, c.question);
            }
            Ok(())
        }
        CardCommands::Add {
            deck_id,
            deck_name,
            question,
            answer,
            extra,
            choice,
            correct_index,
            tag,
            data,
            file,
        } => {
            let did = resolve_deck_id(deck_id, deck_name.as_deref())?;
            let st = Store::open()?;

            if data.is_some() || file.is_some() {
                if question.is_some() || answer.is_some() {
                    return Err(
                        "--data/--file cannot be used with --question or --answer".into(),
                    );
                }
                let payload = read_payload(data.as_deref(), file.as_deref())?;
                let raw: Vec<RawCardInput> =
                    serde_json::from_str(&payload).map_err(|e| format!("invalid JSON: {e}"))?;
                let mut cards = Vec::new();
                for (idx, item) in raw.into_iter().enumerate() {
                    cards.push(normalize_card(item, idx)?);
                }
                st.insert_cards(did, &cards)?;
                println!("Added {} cards to deck id {did}", cards.len());
                return Ok(());
            }

            let q = question.ok_or("--question and --answer are required")?;
            let a = answer.ok_or("--question and --answer are required")?;

            let mut correct_ptr: Option<i64> = None;
            if !choice.is_empty() {
                if correct_index < 0 || correct_index >= choice.len() as i64 {
                    return Err(format!(
                        "--correct-index must be between 0 and {}",
                        choice.len() - 1
                    ));
                }
                correct_ptr = Some(correct_index);
            }

            let card = Card {
                id: 0,
                deck_id: did,
                question: q,
                answer: a,
                extra: extra.unwrap_or_default(),
                choices: choice,
                correct_index: correct_ptr,
                tags: tag,
            };
            let id = st.insert_card(did, &card)?;
            println!("Added card {id} to deck id {did}");
            Ok(())
        }
        CardCommands::Show {
            deck_id,
            deck_name,
            card_id,
        } => {
            let did = resolve_deck_id(deck_id, deck_name.as_deref())?;
            let st = Store::open()?;
            let card = st.get_card(did, card_id)?;
            println!(
                "ID: {}\nQuestion: {}\nAnswer: {}\nExtra: {}",
                card.id, card.question, card.answer, card.extra
            );
            if !card.choices.is_empty() {
                println!("Choices:");
                for (i, ch) in card.choices.iter().enumerate() {
                    let marker = if card.correct_index == Some(i as i64) {
                        "*"
                    } else {
                        " "
                    };
                    println!("  {marker} {}) {ch}", i + 1);
                }
            }
            if !card.tags.is_empty() {
                println!("Tags: {}", card.tags.join(", "));
            }
            Ok(())
        }
        CardCommands::Delete {
            deck_id,
            deck_name,
            card_id,
            card_ids,
        } => {
            let did = resolve_deck_id(deck_id, deck_name.as_deref())?;
            let cid = card_id.unwrap_or(0);
            let cids_raw = card_ids.unwrap_or_default();
            let cids_raw = cids_raw.trim();
            if cid == 0 && cids_raw.is_empty() {
                return Err("either --card-id or --card-ids is required".into());
            }
            if cid != 0 && !cids_raw.is_empty() {
                return Err("specify only one of --card-id or --card-ids".into());
            }
            let ids = if cid != 0 {
                vec![cid]
            } else {
                parse_card_ids(cids_raw)?
            };
            let st = Store::open()?;
            for id in &ids {
                st.delete_card(did, *id)?;
                println!("Deleted card {id} from deck id {did}");
            }
            Ok(())
        }
        CardCommands::Update {
            deck_id,
            deck_name,
            card_id,
            question,
            answer,
            extra,
            choice,
            correct_index,
            tag,
        } => {
            let did = resolve_deck_id(deck_id, deck_name.as_deref())?;
            let st = Store::open()?;
            st.update_card(
                did,
                card_id,
                question.as_deref(),
                answer.as_deref(),
                extra.as_deref(),
                choice.as_deref(),
                correct_index,
                tag.as_deref(),
            )?;
            println!("Updated card {card_id}");
            Ok(())
        }
    }
}

// --- TUI launchers ---

fn run_tree_command() -> Result<(), String> {
    let st = Store::open()?;
    let ctx = st.full_context()?;
    let all_decks = st.list_decks()?;
    let mut cards_by_deck = HashMap::new();
    for deck in &all_decks {
        cards_by_deck.insert(deck.id, st.list_cards(deck.id, 200)?);
    }
    tui::run_tree(ctx.skills, all_decks, cards_by_deck, &st)
        .map_err(|e| e.to_string())
}

fn run_skill_review(skill_name: &str, mode_raw: &str, limit: i64) -> Result<(), String> {
    let mode = parse_mode_with_fallback(mode_raw);
    let st = Store::open()?;
    let tree = st.skill_tree()?;
    let skill = find_skill_by_name(&tree, skill_name)
        .ok_or_else(|| format!("skill \"{skill_name}\" not found"))?;
    let skill_id = skill.id;
    let cards = st.cards_for_skill(skill_id, limit)?;
    if cards.is_empty() {
        println!("No cards found for skill.");
        return Ok(());
    }
    let deck = Deck {
        id: -1,
        name: format!("{skill_name} (all)"),
        description: String::new(),
        card_count: cards.len() as i64,
        covered_count: 0,
        updated_at: String::new(),
    };
    let mut cards_by_deck = HashMap::new();
    cards_by_deck.insert(-1i64, cards);
    tui::run_review(vec![deck], cards_by_deck, 0, mode, true, &st)
        .map_err(|e| e.to_string())
}

fn run_review_session(deck_query: &str, mode_raw: &str, limit: i64) -> Result<(), String> {
    let mode = parse_mode_with_fallback(mode_raw);
    let st = Store::open()?;
    let decks = st.list_decks()?;
    let mut cards_by_deck = HashMap::new();
    for deck in &decks {
        cards_by_deck.insert(deck.id, st.list_cards(deck.id, limit)?);
    }
    let mut selected_index = 0;
    let mut start_in_review = false;
    if !deck_query.is_empty() {
        for (i, d) in decks.iter().enumerate() {
            if d.name.eq_ignore_ascii_case(deck_query) {
                selected_index = i;
                start_in_review = true;
                break;
            }
        }
    }
    tui::run_review(decks, cards_by_deck, selected_index, mode, start_in_review, &st)
        .map_err(|e| e.to_string())
}
