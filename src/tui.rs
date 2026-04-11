use std::collections::{HashMap, HashSet};
use std::io;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use rand::seq::SliceRandom;
use ratatui::prelude::*;
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Terminal;

use crate::store::{Card, Deck, ScenarioDetail, Skill, Store};
use crate::tui_helpers::*;

// --- Types ---

#[derive(Clone)]
struct FlatNode {
    skill: Skill,
    depth: usize,
}

struct DetailSection {
    name: String,
    level: Option<i64>,
    deck_start: usize,
    deck_count: usize,
    scenarios: Vec<ScenarioDetail>,
}

#[derive(Clone, Copy)]
enum DetailAction {
    None,
    Deck(usize),
    Scenario(i64),
}

struct DetailView {
    lines: Vec<Line<'static>>,
    focus_actions: Vec<DetailAction>,
    focus_rows: Vec<usize>,
}

#[derive(PartialEq, Clone, Copy)]
enum AppStage {
    Tree,
    Detail,
    LevelHelp,
    Review,
}

#[derive(PartialEq)]
enum ReviewStage {
    DeckSelect,
    Review,
    Done,
}

// --- Review State ---

struct ReviewState {
    decks: Vec<Deck>,
    cards_by_deck: HashMap<i64, Vec<Card>>,
    deck_cursor: usize,
    cards: Vec<Card>,
    card_cursor: usize,
    choice_cursor: usize,
    show_answer: bool,
    mode: String,
    stage: ReviewStage,
    covered_ids: HashSet<i64>,
    from_tree: bool,
}

impl ReviewState {
    fn new(
        decks: Vec<Deck>,
        cards_by_deck: HashMap<i64, Vec<Card>>,
        initial_deck: usize,
        mode: String,
        start_in_review: bool,
        store: &Store,
    ) -> Self {
        let idx = initial_deck.min(decks.len().saturating_sub(1));
        let (cards, stage, covered_ids) = if start_in_review && !decks.is_empty() {
            let c = cards_by_deck
                .get(&decks[idx].id)
                .cloned()
                .unwrap_or_default();
            let card_ids: Vec<i64> = c.iter().map(|x| x.id).collect();
            let covered = store.covered_card_ids(&card_ids).unwrap_or_default();
            let s = if c.is_empty() {
                ReviewStage::Done
            } else {
                ReviewStage::Review
            };
            (c, s, covered)
        } else {
            (vec![], ReviewStage::DeckSelect, HashSet::new())
        };

        ReviewState {
            decks,
            cards_by_deck,
            deck_cursor: idx,
            cards,
            card_cursor: 0,
            choice_cursor: 0,
            show_answer: false,
            mode,
            stage,
            covered_ids,
            from_tree: start_in_review,
        }
    }

    fn activate_deck(&mut self, index: usize, store: &Store) {
        let deck = &self.decks[index];
        self.cards = self
            .cards_by_deck
            .get(&deck.id)
            .cloned()
            .unwrap_or_default();
        self.card_cursor = 0;
        self.choice_cursor = 0;
        self.show_answer = false;
        self.deck_cursor = index;
        if !self.cards.is_empty() {
            let card_ids: Vec<i64> = self.cards.iter().map(|c| c.id).collect();
            self.covered_ids = store.covered_card_ids(&card_ids).unwrap_or_default();
        } else {
            self.covered_ids.clear();
        }
        self.stage = if self.cards.is_empty() {
            ReviewStage::Done
        } else {
            ReviewStage::Review
        };
    }

    fn current_card(&self) -> Option<&Card> {
        self.cards.get(self.card_cursor)
    }

    fn effective_mode(&self) -> &str {
        let card = match self.current_card() {
            Some(c) => c,
            None => return "flashcard",
        };
        let has_choices = !card.choices.is_empty() && card.correct_index.is_some();
        if self.mode == "flashcard" {
            "flashcard"
        } else if self.mode == "mcq" && has_choices {
            "mcq"
        } else if has_choices {
            "mcq"
        } else {
            "flashcard"
        }
    }
}

// --- Tree State ---

struct TreeState {
    skills: Vec<Skill>,
    expanded: HashSet<i64>,
    cursor: usize,
    stage: AppStage,
    prev_stage: AppStage,
    selected: Option<Skill>,
    detail_cursor: usize,
    detail_decks: Vec<Deck>,
    detail_sections: Vec<DetailSection>,
    detail_scenarios: Vec<ScenarioDetail>,
    collapsed_scenarios: HashSet<i64>,
    // Search
    searching: bool,
    search_query: String,
    search_confirmed: bool,
    match_set: HashSet<i64>,
    search_matches: Vec<usize>,
    search_idx: usize,
    saved_expanded: HashSet<i64>,
    // Review
    review: Option<ReviewState>,
    // Data
    #[allow(dead_code)]
    all_decks: Vec<Deck>,
    cards_by_deck: HashMap<i64, Vec<Card>>,
}

impl TreeState {
    fn flat_nodes(&self) -> Vec<FlatNode> {
        let mut nodes = Vec::new();
        fn walk(
            skills: &[Skill],
            depth: usize,
            expanded: &HashSet<i64>,
            nodes: &mut Vec<FlatNode>,
        ) {
            for skill in skills {
                nodes.push(FlatNode {
                    skill: skill.clone(),
                    depth,
                });
                if expanded.contains(&skill.id) {
                    walk(&skill.children, depth + 1, expanded, nodes);
                }
            }
        }
        walk(&self.skills, 0, &self.expanded, &mut nodes);
        nodes
    }

    fn load_detail_data(&mut self, skill: &Skill, store: &Store) {
        let mut d_decks = Vec::new();
        let mut sections = Vec::new();
        let mut d_scenarios = Vec::new();
        let mut collapsed_scenarios = HashSet::new();

        if !skill.decks.is_empty() || !skill.scenarios.is_empty() {
            let mut scenarios: Vec<ScenarioDetail> = skill
                .scenarios
                .iter()
                .filter_map(|scenario| store.get_scenario_detail(scenario.id).ok())
                .collect();
            sort_scenarios_by_activity(&mut scenarios);
            for scenario in &scenarios {
                collapsed_scenarios.insert(scenario.id);
            }
            sections.push(DetailSection {
                name: skill.name.clone(),
                level: skill.level,
                deck_start: d_decks.len(),
                deck_count: skill.decks.len(),
                scenarios: scenarios.clone(),
            });
            d_decks.extend(skill.decks.clone());
            d_scenarios.extend(scenarios);
        }

        for child in &skill.children {
            if child.decks.is_empty() && child.scenarios.is_empty() {
                continue;
            }
            let mut scenarios: Vec<ScenarioDetail> = child
                .scenarios
                .iter()
                .filter_map(|scenario| store.get_scenario_detail(scenario.id).ok())
                .collect();
            sort_scenarios_by_activity(&mut scenarios);
            for scenario in &scenarios {
                collapsed_scenarios.insert(scenario.id);
            }
            sections.push(DetailSection {
                name: child.name.clone(),
                level: child.level,
                deck_start: d_decks.len(),
                deck_count: child.decks.len(),
                scenarios: scenarios.clone(),
            });
            d_decks.extend(child.decks.clone());
            d_scenarios.extend(scenarios);
        }

        self.detail_decks = d_decks;
        self.detail_sections = sections;
        self.detail_scenarios = d_scenarios;
        self.collapsed_scenarios = collapsed_scenarios;
        self.detail_cursor = 0;
    }

    fn collect_skill_cards(&self, skill: &Skill) -> Vec<Card> {
        let mut cards = Vec::new();
        for d in &skill.decks {
            if let Some(c) = self.cards_by_deck.get(&d.id) {
                cards.extend(c.clone());
            }
        }
        for child in &skill.children {
            for d in &child.decks {
                if let Some(c) = self.cards_by_deck.get(&d.id) {
                    cards.extend(c.clone());
                }
            }
        }
        // Shuffle
        let mut rng = rand::thread_rng();
        cards.shuffle(&mut rng);
        cards
    }

    fn apply_search(&mut self, query: &str) {
        let mut new_exp = self.saved_expanded.clone();
        let mut new_match_set = HashSet::new();

        if query.is_empty() {
            self.expanded = new_exp;
            self.match_set.clear();
            self.search_matches.clear();
            return;
        }

        let q = query.to_lowercase();
        fn walk_for_search(
            skills: &[Skill],
            ancestors: &[i64],
            q: &str,
            new_exp: &mut HashSet<i64>,
            new_match_set: &mut HashSet<i64>,
        ) {
            for skill in skills {
                let mut path = ancestors.to_vec();
                path.push(skill.id);
                if skill.name.to_lowercase().contains(q) {
                    new_match_set.insert(skill.id);
                    for &aid in ancestors {
                        new_exp.insert(aid);
                    }
                }
                if !skill.children.is_empty() {
                    walk_for_search(&skill.children, &path, q, new_exp, new_match_set);
                }
            }
        }
        walk_for_search(&self.skills, &[], &q, &mut new_exp, &mut new_match_set);

        self.expanded = new_exp;
        self.match_set = new_match_set.clone();

        // Rebuild flat nodes to find matches
        let nodes = self.flat_nodes();
        let matches: Vec<usize> = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| new_match_set.contains(&n.skill.id))
            .map(|(i, _)| i)
            .collect();
        self.search_matches = matches.clone();
        self.search_idx = 0;
        if !matches.is_empty() {
            self.cursor = matches[0];
        }
    }
}

// --- Coverage text ---

fn coverage_text(covered: i64, total: i64) -> String {
    if total == 0 {
        "--".to_string()
    } else {
        format!("{}%", (covered * 100) / total)
    }
}

fn coverage_color(covered: i64, total: i64) -> Color {
    if total == 0 {
        return Color::DarkGray;
    }
    let pct = (covered * 100) / total;
    if pct >= 100 {
        Color::Green
    } else if pct >= 50 {
        Color::Cyan
    } else if pct > 0 {
        Color::Yellow
    } else {
        Color::DarkGray
    }
}

fn leaf_info(skill: &Skill) -> String {
    let d = skill.decks.len();
    let s = skill.scenarios.len();
    if d == 0 && s == 0 {
        return String::new();
    }
    let mut parts = Vec::new();
    if d > 0 {
        parts.push(format!("{d} {}", if d == 1 { "deck" } else { "decks" }));
    }
    if s > 0 {
        parts.push(format!(
            "{s} {}",
            if s == 1 { "scenario" } else { "scenarios" }
        ));
    }
    format!("[{}]", parts.join(" · "))
}

fn pad_right(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len >= width {
        s.to_string()
    } else {
        format!("{}{}", s, " ".repeat(width - len))
    }
}

fn truncate_with_ellipsis(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len <= width {
        return s.to_string();
    }
    if width == 0 {
        return String::new();
    }
    if width == 1 {
        return "…".to_string();
    }

    let mut out = String::with_capacity(width);
    for ch in s.chars().take(width - 1) {
        out.push(ch);
    }
    out.push('…');
    out
}

// --- TUI entry points ---

pub fn run_tree(
    skills: Vec<Skill>,
    all_decks: Vec<Deck>,
    cards_by_deck: HashMap<i64, Vec<Card>>,
    store: &Store,
) -> io::Result<()> {
    let mut state = TreeState {
        skills,
        expanded: HashSet::new(),
        cursor: 0,
        stage: AppStage::Tree,
        prev_stage: AppStage::Tree,
        selected: None,
        detail_cursor: 0,
        detail_decks: vec![],
        detail_sections: vec![],
        detail_scenarios: vec![],
        collapsed_scenarios: HashSet::new(),
        searching: false,
        search_query: String::new(),
        search_confirmed: false,
        match_set: HashSet::new(),
        search_matches: vec![],
        search_idx: 0,
        saved_expanded: HashSet::new(),
        review: None,
        all_decks,
        cards_by_deck,
    };

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_tree_loop(&mut terminal, &mut state, store);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

pub fn run_review(
    decks: Vec<Deck>,
    cards_by_deck: HashMap<i64, Vec<Card>>,
    selected_deck: usize,
    mode: String,
    start_in_review: bool,
    store: &Store,
) -> io::Result<()> {
    let mut review = ReviewState::new(
        decks,
        cards_by_deck,
        selected_deck,
        mode,
        start_in_review,
        store,
    );

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_review_loop(&mut terminal, &mut review, store);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

// --- Main loops ---

fn run_tree_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    state: &mut TreeState,
    store: &Store,
) -> io::Result<()> {
    loop {
        terminal.draw(|f| draw_tree(f, state))?;

        if let Event::Key(key) = event::read()? {
            if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                return Ok(());
            }

            if state.stage == AppStage::Review {
                if let Some(ref mut review) = state.review {
                    let done = handle_review_input(key, review, store);
                    if done {
                        state.review = None;
                        state.stage = if state.prev_stage == AppStage::Review {
                            AppStage::Tree
                        } else {
                            state.prev_stage
                        };
                    }
                }
                continue;
            }

            if state.stage == AppStage::LevelHelp {
                match key.code {
                    KeyCode::Char('q') => return Ok(()),
                    KeyCode::Char('b') | KeyCode::Esc | KeyCode::Char('?') => {
                        state.stage = state.prev_stage;
                    }
                    _ => {}
                }
                continue;
            }

            if state.stage == AppStage::Detail {
                match key.code {
                    KeyCode::Char('q') => return Ok(()),
                    KeyCode::Char('b') | KeyCode::Esc => {
                        state.stage = AppStage::Tree;
                        state.selected = None;
                    }
                    KeyCode::Up | KeyCode::Char('k') => {
                        if state.detail_cursor > 0 {
                            state.detail_cursor -= 1;
                        }
                    }
                    KeyCode::Down | KeyCode::Char('j') => {
                        if let Some(ref skill) = state.selected {
                            let detail = build_detail_view(skill, &state, usize::MAX);
                            if state.detail_cursor + 1 < detail.focus_actions.len() {
                                state.detail_cursor += 1;
                            }
                        }
                    }
                    KeyCode::Char('?') => {
                        state.prev_stage = AppStage::Detail;
                        state.stage = AppStage::LevelHelp;
                    }
                    KeyCode::Char('t') => {
                        if let Some(ref skill) = state.selected {
                            let cards = state.collect_skill_cards(skill);
                            if !cards.is_empty() {
                                let deck = Deck {
                                    id: -1,
                                    name: format!("{} (test)", skill.name),
                                    description: String::new(),
                                    card_count: cards.len() as i64,
                                    covered_count: 0,
                                    updated_at: String::new(),
                                };
                                let mut cbm = HashMap::new();
                                cbm.insert(-1i64, cards);
                                state.review = Some(ReviewState::new(
                                    vec![deck],
                                    cbm,
                                    0,
                                    "auto".into(),
                                    true,
                                    store,
                                ));
                                state.prev_stage = AppStage::Detail;
                                state.stage = AppStage::Review;
                            }
                        }
                    }
                    KeyCode::Enter | KeyCode::Char(' ') => {
                        if let Some(ref skill) = state.selected {
                            let detail = build_detail_view(skill, &state, usize::MAX);
                            if state.detail_cursor >= detail.focus_actions.len()
                                && !detail.focus_actions.is_empty()
                            {
                                state.detail_cursor = detail.focus_actions.len() - 1;
                            }
                            let action = detail
                                .focus_actions
                                .get(state.detail_cursor)
                                .copied()
                                .unwrap_or(DetailAction::None);
                            match action {
                                DetailAction::Deck(deck_index)
                                    if !state.detail_decks.is_empty() =>
                                {
                                    let mut r_cards = HashMap::new();
                                    for d in &state.detail_decks {
                                        r_cards.insert(
                                            d.id,
                                            state
                                                .cards_by_deck
                                                .get(&d.id)
                                                .cloned()
                                                .unwrap_or_default(),
                                        );
                                    }
                                    state.review = Some(ReviewState::new(
                                        state.detail_decks.clone(),
                                        r_cards,
                                        deck_index,
                                        "auto".into(),
                                        true,
                                        store,
                                    ));
                                    state.prev_stage = AppStage::Detail;
                                    state.stage = AppStage::Review;
                                }
                                DetailAction::Deck(_) => {}
                                DetailAction::Scenario(id) => {
                                    if state.collapsed_scenarios.contains(&id) {
                                        state.collapsed_scenarios.remove(&id);
                                    } else {
                                        state.collapsed_scenarios.insert(id);
                                    }
                                }
                                DetailAction::None => {}
                            }
                        }
                    }
                    _ => {}
                }
                continue;
            }

            // Tree stage
            if state.searching {
                match key.code {
                    KeyCode::Esc => {
                        state.expanded = state.saved_expanded.clone();
                        state.searching = false;
                        state.search_confirmed = false;
                        state.search_query.clear();
                        state.match_set.clear();
                        state.search_matches.clear();
                        let nodes = state.flat_nodes();
                        if state.cursor >= nodes.len() {
                            state.cursor = nodes.len().saturating_sub(1);
                        }
                    }
                    KeyCode::Enter => {
                        if !state.search_matches.is_empty() {
                            state.searching = false;
                            state.search_confirmed = true;
                            state.saved_expanded = HashSet::new();
                        } else {
                            state.expanded = state.saved_expanded.clone();
                            state.searching = false;
                            state.search_query.clear();
                            state.match_set.clear();
                            state.search_matches.clear();
                            let nodes = state.flat_nodes();
                            if state.cursor >= nodes.len() {
                                state.cursor = nodes.len().saturating_sub(1);
                            }
                        }
                    }
                    KeyCode::Backspace => {
                        state.search_query.pop();
                        let q = state.search_query.clone();
                        state.apply_search(&q);
                    }
                    KeyCode::Char(c)
                        if !key.modifiers.contains(KeyModifiers::CONTROL)
                            && !key.modifiers.contains(KeyModifiers::ALT) =>
                    {
                        state.search_query.push(c);
                        let q = state.search_query.clone();
                        state.apply_search(&q);
                    }
                    _ => {}
                }
                continue;
            }

            let flat_nodes = state.flat_nodes();
            match key.code {
                KeyCode::Char('q') => return Ok(()),
                KeyCode::Char('/') => {
                    state.searching = true;
                    state.search_query.clear();
                    state.search_confirmed = false;
                    state.saved_expanded = state.expanded.clone();
                    state.match_set.clear();
                    state.search_matches.clear();
                }
                KeyCode::Esc => {
                    if state.search_confirmed {
                        state.search_confirmed = false;
                        state.match_set.clear();
                        state.search_matches.clear();
                        state.search_idx = 0;
                    }
                }
                KeyCode::Char('n')
                    if state.search_confirmed && !state.search_matches.is_empty() =>
                {
                    state.search_idx = (state.search_idx + 1) % state.search_matches.len();
                    state.cursor = state.search_matches[state.search_idx];
                }
                KeyCode::Char('N')
                    if state.search_confirmed && !state.search_matches.is_empty() =>
                {
                    state.search_idx = (state.search_idx + state.search_matches.len() - 1)
                        % state.search_matches.len();
                    state.cursor = state.search_matches[state.search_idx];
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    if state.cursor > 0 {
                        state.cursor -= 1;
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    if state.cursor + 1 < flat_nodes.len() {
                        state.cursor += 1;
                    }
                }
                KeyCode::Char('?') => {
                    state.prev_stage = AppStage::Tree;
                    state.stage = AppStage::LevelHelp;
                }
                KeyCode::Char('d') => {
                    if state.cursor < flat_nodes.len() {
                        let skill = flat_nodes[state.cursor].skill.clone();
                        state.load_detail_data(&skill, store);
                        state.selected = Some(skill);
                        state.stage = AppStage::Detail;
                    }
                }
                KeyCode::Char('t') => {
                    if state.cursor < flat_nodes.len() {
                        let skill = &flat_nodes[state.cursor].skill;
                        let cards = state.collect_skill_cards(skill);
                        if !cards.is_empty() {
                            let deck = Deck {
                                id: -1,
                                name: format!("{} (test)", skill.name),
                                description: String::new(),
                                card_count: cards.len() as i64,
                                covered_count: 0,
                                updated_at: String::new(),
                            };
                            let mut cbm = HashMap::new();
                            cbm.insert(-1i64, cards);
                            state.review = Some(ReviewState::new(
                                vec![deck],
                                cbm,
                                0,
                                "auto".into(),
                                true,
                                store,
                            ));
                            state.prev_stage = AppStage::Tree;
                            state.stage = AppStage::Review;
                        }
                    }
                }
                KeyCode::Enter | KeyCode::Char(' ') => {
                    if state.cursor < flat_nodes.len() {
                        let node = &flat_nodes[state.cursor];
                        if !node.skill.children.is_empty() {
                            let id = node.skill.id;
                            if state.expanded.contains(&id) {
                                state.expanded.remove(&id);
                            } else {
                                state.expanded.insert(id);
                            }
                        } else {
                            let skill = node.skill.clone();
                            state.load_detail_data(&skill, store);
                            state.selected = Some(skill);
                            state.stage = AppStage::Detail;
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn run_review_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    review: &mut ReviewState,
    store: &Store,
) -> io::Result<()> {
    loop {
        terminal.draw(|f| draw_review(f, review))?;

        if let Event::Key(key) = event::read()? {
            if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                return Ok(());
            }
            if handle_review_input(key, review, store) {
                return Ok(());
            }
        }
    }
}

/// Returns true if the review should close (go back / quit)
fn handle_review_input(key: KeyEvent, review: &mut ReviewState, store: &Store) -> bool {
    match review.stage {
        ReviewStage::DeckSelect => match key.code {
            KeyCode::Char('q') | KeyCode::Esc | KeyCode::Char('b') => return true,
            KeyCode::Up | KeyCode::Char('k') => {
                if review.deck_cursor > 0 {
                    review.deck_cursor -= 1;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if review.deck_cursor + 1 < review.decks.len() {
                    review.deck_cursor += 1;
                }
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                review.activate_deck(review.deck_cursor, store);
            }
            _ => {}
        },
        ReviewStage::Done => match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return true,
            KeyCode::Char('b') | KeyCode::Enter | KeyCode::Char(' ') => {
                if review.from_tree {
                    return true;
                } else if !review.decks.is_empty() {
                    review.stage = ReviewStage::DeckSelect;
                } else {
                    return true;
                }
            }
            _ => {}
        },
        ReviewStage::Review => match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return true,
            KeyCode::Char('b') => {
                if review.from_tree {
                    return true;
                } else if !review.decks.is_empty() {
                    review.stage = ReviewStage::DeckSelect;
                }
            }
            KeyCode::Left | KeyCode::Char('h') | KeyCode::Char('p') => {
                if review.card_cursor > 0 {
                    review.card_cursor -= 1;
                    review.show_answer = false;
                    review.choice_cursor = 0;
                }
            }
            KeyCode::Right | KeyCode::Char('l') | KeyCode::Char('n') => {
                if review.card_cursor + 1 < review.cards.len() {
                    review.card_cursor += 1;
                    review.show_answer = false;
                    review.choice_cursor = 0;
                }
            }
            KeyCode::Char('N') => {
                let next = (review.card_cursor + 10).min(review.cards.len().saturating_sub(1));
                if next != review.card_cursor {
                    review.card_cursor = next;
                    review.show_answer = false;
                    review.choice_cursor = 0;
                }
            }
            KeyCode::Char('P') => {
                let next = review.card_cursor.saturating_sub(10);
                if next != review.card_cursor {
                    review.card_cursor = next;
                    review.show_answer = false;
                    review.choice_cursor = 0;
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                if review.effective_mode() == "mcq" {
                    if let Some(card) = review.current_card() {
                        if !card.choices.is_empty() {
                            review.choice_cursor = (review.choice_cursor + card.choices.len() - 1)
                                % card.choices.len();
                        }
                    }
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if review.effective_mode() == "mcq" {
                    if let Some(card) = review.current_card() {
                        if !card.choices.is_empty() {
                            review.choice_cursor = (review.choice_cursor + 1) % card.choices.len();
                        }
                    }
                }
            }
            KeyCode::Char('f') => review.mode = "flashcard".into(),
            KeyCode::Char('m') => review.mode = "mcq".into(),
            KeyCode::Char('a') => review.mode = "auto".into(),
            KeyCode::Enter | KeyCode::Char(' ') => {
                if review.show_answer {
                    // Mark covered and advance
                    if let Some(card) = review.current_card() {
                        let _ = store.mark_card_covered(card.id);
                        review.covered_ids.insert(card.id);
                    }
                    if review.card_cursor >= review.cards.len().saturating_sub(1) {
                        review.stage = ReviewStage::Done;
                    } else {
                        review.card_cursor += 1;
                        review.show_answer = false;
                        review.choice_cursor = 0;
                    }
                } else {
                    review.show_answer = true;
                    // MCQ auto-mark if correct
                    if review.effective_mode() == "mcq" {
                        if let Some(card) = review.current_card() {
                            if card.correct_index == Some(review.choice_cursor as i64) {
                                let _ = store.mark_card_covered(card.id);
                                review.covered_ids.insert(card.id);
                            }
                        }
                    }
                }
            }
            _ => {}
        },
    }
    false
}

// --- Drawing ---

fn draw_tree(f: &mut Frame, state: &TreeState) {
    let area = f.area();

    if state.stage == AppStage::Review {
        if let Some(ref review) = state.review {
            draw_review(f, review);
            return;
        }
    }

    if state.stage == AppStage::LevelHelp {
        draw_level_help(f, area);
        return;
    }

    if state.stage == AppStage::Detail {
        draw_detail(f, state, area);
        return;
    }

    // Tree view
    let flat_nodes = state.flat_nodes();
    let mut lines = Vec::new();

    lines.push(Line::from(Span::styled(
        "Skill Tree",
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    if flat_nodes.is_empty() {
        lines.push(Line::from("No skills found."));
        lines.push(Line::from("Use the CLI to add skills to your tree."));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "q Quit",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        let max_visible = area.height.saturating_sub(5) as usize; // header + footer + padding
        let scroll_offset = if flat_nodes.len() > max_visible && state.cursor >= max_visible {
            (state.cursor - max_visible + 1).min(flat_nodes.len().saturating_sub(max_visible))
        } else {
            0
        };
        let visible_end = (scroll_offset + max_visible).min(flat_nodes.len());
        let base_name_col_width: usize = 40;
        let child_level_offset: usize = 6;

        for (i, node) in flat_nodes
            .iter()
            .enumerate()
            .skip(scroll_offset)
            .take(visible_end - scroll_offset)
        {
            let indent = "  ".repeat(node.depth);
            let prefix = if !node.skill.children.is_empty() {
                if state.expanded.contains(&node.skill.id) {
                    "▼ "
                } else {
                    "▶ "
                }
            } else {
                "─ "
            };
            let cursor_str = if i == state.cursor { "> " } else { "  " };
            let is_match = state.match_set.contains(&node.skill.id);
            let info = leaf_info(&node.skill);

            let name_prefix = format!("{cursor_str}{indent}{prefix}");
            let depth_offset = if node.depth == 0 {
                0
            } else {
                child_level_offset
            };
            let name_col_width = base_name_col_width + depth_offset;
            let name_width = name_col_width.saturating_sub(name_prefix.chars().count());
            let fitted_name = truncate_with_ellipsis(&node.skill.name, name_width);
            let fitted = format!("{name_prefix}{fitted_name}");
            let padded = pad_right(&fitted, name_col_width);

            let name_style = if i == state.cursor {
                let mut s = Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD);
                if is_match {
                    s = s.add_modifier(Modifier::UNDERLINED);
                }
                s
            } else if is_match {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };

            let mut spans = vec![Span::styled(padded, name_style)];

            if let Some(skill_level) = node.skill.level {
                let level = clamp_level(skill_level);
                let level_lbl = level_label(skill_level);
                let level_color = LEVEL_COLORS[level];
                let filled = "█".repeat(level);
                let empty = "░".repeat(5 - level);

                spans.push(Span::raw("  "));
                spans.push(Span::styled(filled, Style::default().fg(level_color)));
                spans.push(Span::styled(empty, Style::default().fg(Color::DarkGray)));
                spans.push(Span::raw(" "));
                spans.push(Span::styled(
                    format!("{skill_level}/5 {level_lbl}"),
                    Style::default().fg(level_color),
                ));
            }

            if !info.is_empty() {
                spans.push(Span::raw("   "));
                spans.push(Span::styled(info, Style::default().fg(Color::DarkGray)));
            }

            lines.push(Line::from(spans));
        }

        lines.push(Line::from(""));

        // Footer
        if state.searching {
            let mut spans = vec![
                Span::styled("/", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(&state.search_query),
                Span::styled("_", Style::default().fg(Color::DarkGray)),
            ];
            if !state.search_query.is_empty() {
                if state.search_matches.is_empty() {
                    spans.push(Span::styled(
                        "  no matches",
                        Style::default().fg(Color::Red),
                    ));
                } else {
                    spans.push(Span::styled(
                        format!("  {}/{}", state.search_idx + 1, state.search_matches.len()),
                        Style::default().fg(Color::DarkGray),
                    ));
                }
            }
            lines.push(Line::from(spans));
        } else if state.search_confirmed {
            lines.push(Line::from(Span::styled(
                "j/k Navigate n/N Next/Prev match / Search enter Expand d Detail t Test esc Clear q Quit",
                Style::default().fg(Color::DarkGray),
            )));
        } else {
            lines.push(Line::from(Span::styled(
                "j/k Navigate enter Expand/Collapse d Detail t Test / Search ? Levels q Quit",
                Style::default().fg(Color::DarkGray),
            )));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(Block::default().padding(ratatui::widgets::Padding::horizontal(2)));
    f.render_widget(paragraph, area);
}

fn draw_level_help(f: &mut Frame, area: Rect) {
    let mut lines = Vec::new();
    lines.push(Line::from(Span::styled(
        "Skill Levels",
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    for (i, label) in LEVEL_LABELS.iter().enumerate() {
        let filled = "█".repeat(i);
        let empty = "░".repeat(5 - i);
        let color = LEVEL_COLORS[i];
        let spans = vec![
            Span::raw(format!("  {i} ")),
            Span::styled(filled, Style::default().fg(color)),
            Span::styled(empty, Style::default().fg(Color::DarkGray)),
            Span::raw(" "),
            Span::styled(
                format!("{:<12}", label),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(LEVEL_DESCRIPTIONS[i], Style::default().fg(Color::DarkGray)),
        ];
        lines.push(Line::from(spans));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "b Back q Quit",
        Style::default().fg(Color::DarkGray),
    )));

    let paragraph = Paragraph::new(lines)
        .block(Block::default().padding(ratatui::widgets::Padding::horizontal(2)));
    f.render_widget(paragraph, area);
}

fn push_static_line(lines: &mut Vec<Line<'static>>, line: Line<'static>) {
    lines.push(line);
}

fn push_focus_line(
    lines: &mut Vec<Line<'static>>,
    focus_actions: &mut Vec<DetailAction>,
    focus_rows: &mut Vec<usize>,
    line: Line<'static>,
    action: DetailAction,
) {
    focus_rows.push(lines.len());
    lines.push(line);
    focus_actions.push(action);
}

fn effective_scenario_updated_at(scenario: &ScenarioDetail) -> &str {
    scenario
        .steps
        .iter()
        .map(|step| step.updated_at.as_str())
        .chain(std::iter::once(scenario.updated_at.as_str()))
        .max()
        .unwrap_or(scenario.updated_at.as_str())
}

fn sort_scenarios_by_activity(scenarios: &mut [ScenarioDetail]) {
    scenarios.sort_by(|a, b| {
        effective_scenario_updated_at(b)
            .cmp(effective_scenario_updated_at(a))
            .then_with(|| a.name.cmp(&b.name))
    });
}

fn normalize_description_paragraphs(description: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut current = Vec::new();

    for raw_line in description.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            if !current.is_empty() {
                paragraphs.push(current.join(" "));
                current.clear();
            }
            continue;
        }
        current.push(line.to_string());
    }

    if !current.is_empty() {
        paragraphs.push(current.join(" "));
    }

    paragraphs
}

fn wrap_paragraph(text: &str, width: usize) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    if width == 0 {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let next_len =
            current.chars().count() + usize::from(!current.is_empty()) + word.chars().count();
        if next_len <= width {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
            continue;
        }

        if !current.is_empty() {
            lines.push(current);
            current = String::new();
        }

        current.push_str(word);
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

fn push_scenario_lines(
    lines: &mut Vec<Line<'static>>,
    focus_actions: &mut Vec<DetailAction>,
    focus_rows: &mut Vec<usize>,
    state: &TreeState,
    scenario: &ScenarioDetail,
    indent: &str,
    content_width: usize,
) {
    let icon = status_icon(&scenario.status);
    let collapsed = state.collapsed_scenarios.contains(&scenario.id);
    let arrow = if collapsed { "▸" } else { "▾" };
    let selected = state.detail_cursor == focus_actions.len();
    let name_style = if selected {
        Style::default()
            .fg(Color::Magenta)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    };

    push_focus_line(
        lines,
        focus_actions,
        focus_rows,
        Line::from(vec![
            Span::styled(
                format!("{indent}{arrow} {icon} {}", scenario.name),
                name_style,
            ),
            Span::raw("  "),
            Span::styled(
                format!(
                    "{}/{} complete",
                    scenario.progress.completed_steps, scenario.progress.total_steps
                ),
                Style::default().fg(Color::DarkGray),
            ),
        ]),
        DetailAction::Scenario(scenario.id),
    );

    if collapsed {
        return;
    }

    for step in &scenario.steps {
        let step_icon = status_icon(&step.status);
        push_static_line(
            lines,
            Line::from(format!(
                "{indent}  {step_icon} {}. {}",
                step.position, step.title
            )),
        );
        if !step.description.is_empty() {
            let desc_prefix = format!("{indent}      ");
            let desc_width = content_width.saturating_sub(desc_prefix.chars().count());
            let desc_style = Style::default().fg(Color::Rgb(150, 160, 176));

            for (paragraph_idx, paragraph) in normalize_description_paragraphs(&step.description)
                .into_iter()
                .enumerate()
            {
                if paragraph_idx > 0 {
                    push_static_line(lines, Line::from(""));
                }
                for wrapped_line in wrap_paragraph(&paragraph, desc_width) {
                    push_static_line(
                        lines,
                        Line::from(Span::styled(
                            format!("{desc_prefix}{wrapped_line}"),
                            desc_style,
                        )),
                    );
                }
            }
        }
    }
}

fn build_detail_view(skill: &Skill, state: &TreeState, content_width: usize) -> DetailView {
    let has_children = !skill.children.is_empty();
    let mut lines = Vec::new();
    let mut focus_actions = Vec::new();
    let mut focus_rows = Vec::new();

    let mut header_spans = vec![Span::styled(
        skill.name.clone(),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )];
    if let Some(skill_level) = skill.level {
        let level = clamp_level(skill_level);
        let filled = "█".repeat(level);
        let empty = "░".repeat(5 - level);
        let color = LEVEL_COLORS[level];
        header_spans.push(Span::raw("    "));
        header_spans.push(Span::styled(filled, Style::default().fg(color)));
        header_spans.push(Span::styled(empty, Style::default().fg(Color::DarkGray)));
        header_spans.push(Span::raw(" "));
        header_spans.push(Span::styled(
            format!("{skill_level}/5 {}", LEVEL_LABELS[level]),
            Style::default().fg(color),
        ));
    }
    push_static_line(&mut lines, Line::from(header_spans));

    if !skill.description.is_empty() {
        push_static_line(
            &mut lines,
            Line::from(Span::styled(
                skill.description.clone(),
                Style::default().fg(Color::DarkGray),
            )),
        );
    }

    if state.detail_decks.is_empty() && state.detail_scenarios.is_empty() {
        push_static_line(&mut lines, Line::from(""));
        push_static_line(&mut lines, Line::from("  No decks or scenarios linked."));
    } else if !has_children {
        push_static_line(&mut lines, Line::from(""));
        if !state.detail_decks.is_empty() {
            push_static_line(
                &mut lines,
                Line::from(Span::styled(
                    "Decks",
                    Style::default().add_modifier(Modifier::BOLD),
                )),
            );
            for (i, d) in state.detail_decks.iter().enumerate() {
                let selected = state.detail_cursor == focus_actions.len();
                let prefix = if selected { "  > " } else { "    " };
                let name_style = if selected {
                    Style::default()
                        .fg(Color::Magenta)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                };
                let cov = coverage_text(d.covered_count, d.card_count);
                let cov_color = coverage_color(d.covered_count, d.card_count);
                push_focus_line(
                    &mut lines,
                    &mut focus_actions,
                    &mut focus_rows,
                    Line::from(vec![
                        Span::styled(format!("{prefix}{}", d.name), name_style),
                        Span::raw("  "),
                        Span::styled(
                            format!("{} cards", d.card_count),
                            Style::default().fg(Color::DarkGray),
                        ),
                        Span::raw(" "),
                        Span::styled(cov, Style::default().fg(cov_color)),
                    ]),
                    DetailAction::Deck(i),
                );
            }
        }
        if !state.detail_scenarios.is_empty() {
            push_static_line(&mut lines, Line::from(""));
            push_static_line(
                &mut lines,
                Line::from(Span::styled(
                    "Scenarios",
                    Style::default().add_modifier(Modifier::BOLD),
                )),
            );
            for scenario in &state.detail_scenarios {
                push_scenario_lines(
                    &mut lines,
                    &mut focus_actions,
                    &mut focus_rows,
                    state,
                    scenario,
                    "  ",
                    content_width,
                );
            }
        }
    } else {
        for sec in &state.detail_sections {
            push_static_line(&mut lines, Line::from(""));
            let mut sec_spans = vec![Span::styled(
                sec.name.clone(),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )];
            if let Some(sec_level_value) = sec.level {
                let sec_level = clamp_level(sec_level_value);
                let sec_color = LEVEL_COLORS[sec_level];
                let filled = "█".repeat(sec_level);
                let empty = "░".repeat(5 - sec_level);
                sec_spans.push(Span::raw("  "));
                sec_spans.push(Span::styled(filled, Style::default().fg(sec_color)));
                sec_spans.push(Span::styled(empty, Style::default().fg(Color::DarkGray)));
                sec_spans.push(Span::raw(" "));
                sec_spans.push(Span::styled(
                    format!("{sec_level_value}/5 {}", LEVEL_LABELS[sec_level]),
                    Style::default().fg(sec_color),
                ));
            }
            push_static_line(&mut lines, Line::from(sec_spans));

            if sec.deck_count > 0 {
                push_static_line(
                    &mut lines,
                    Line::from(Span::styled(
                        "  Decks:",
                        Style::default().fg(Color::DarkGray),
                    )),
                );
                for di in 0..sec.deck_count {
                    let idx = sec.deck_start + di;
                    let d = &state.detail_decks[idx];
                    let selected = state.detail_cursor == focus_actions.len();
                    let prefix = if selected { "    > " } else { "      " };
                    let name_style = if selected {
                        Style::default()
                            .fg(Color::Magenta)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                    };
                    let cov = coverage_text(d.covered_count, d.card_count);
                    let cov_color = coverage_color(d.covered_count, d.card_count);
                    push_focus_line(
                        &mut lines,
                        &mut focus_actions,
                        &mut focus_rows,
                        Line::from(vec![
                            Span::styled(format!("{prefix}{}", d.name), name_style),
                            Span::raw("  "),
                            Span::styled(
                                format!("{} cards", d.card_count),
                                Style::default().fg(Color::DarkGray),
                            ),
                            Span::raw(" "),
                            Span::styled(cov, Style::default().fg(cov_color)),
                        ]),
                        DetailAction::Deck(idx),
                    );
                }
            }

            if !sec.scenarios.is_empty() {
                push_static_line(
                    &mut lines,
                    Line::from(Span::styled(
                        "  Scenarios:",
                        Style::default().fg(Color::DarkGray),
                    )),
                );
                for scenario in &sec.scenarios {
                    push_scenario_lines(
                        &mut lines,
                        &mut focus_actions,
                        &mut focus_rows,
                        state,
                        scenario,
                        "    ",
                        content_width,
                    );
                }
            }
        }
    }

    push_static_line(&mut lines, Line::from(""));
    push_static_line(
        &mut lines,
        Line::from(Span::styled(
            "j/k Navigate enter Review/Toggle t Test ? Levels b Back q Quit",
            Style::default().fg(Color::DarkGray),
        )),
    );

    DetailView {
        lines,
        focus_actions,
        focus_rows,
    }
}

fn draw_detail(f: &mut Frame, state: &TreeState, area: Rect) {
    let selected = match &state.selected {
        Some(skill) => skill,
        None => {
            let p = Paragraph::new("No skill selected.")
                .block(Block::default().padding(ratatui::widgets::Padding::horizontal(2)));
            f.render_widget(p, area);
            return;
        }
    };

    let content_width = area.width.saturating_sub(4) as usize;
    let detail = build_detail_view(selected, state, content_width);
    let viewport_height = area.height.max(1) as usize;
    let scroll_row = detail
        .focus_rows
        .get(state.detail_cursor)
        .copied()
        .unwrap_or(0);
    let scroll = scroll_row.saturating_sub(viewport_height.saturating_sub(1)) as u16;

    let paragraph = Paragraph::new(detail.lines)
        .scroll((scroll, 0))
        .block(Block::default().padding(ratatui::widgets::Padding::horizontal(2)));
    f.render_widget(paragraph, area);
}

fn draw_review(f: &mut Frame, review: &ReviewState) {
    let area = f.area();
    let mut lines = Vec::new();

    match review.stage {
        ReviewStage::DeckSelect => {
            lines.push(Line::from(Span::styled(
                "Select a deck",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(Span::styled(
                "j/k Navigate enter Select b Back q Quit",
                Style::default().fg(Color::DarkGray),
            )));
            lines.push(Line::from(""));

            if review.decks.is_empty() {
                lines.push(Line::from("No decks found."));
                lines.push(Line::from("Ask an agent to create a deck for you."));
            } else {
                for (i, d) in review.decks.iter().enumerate() {
                    let prefix = if i == review.deck_cursor { "> " } else { "  " };
                    let name_style = if i == review.deck_cursor {
                        Style::default()
                            .fg(Color::Magenta)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                    };
                    let cov = coverage_text(d.covered_count, d.card_count);
                    let cov_color = coverage_color(d.covered_count, d.card_count);
                    lines.push(Line::from(vec![
                        Span::styled(format!("{prefix}{} ({})", d.name, d.card_count), name_style),
                        Span::raw(" "),
                        Span::styled(cov, Style::default().fg(cov_color)),
                    ]));
                }
            }
        }
        ReviewStage::Done => {
            lines.push(Line::from(Span::styled(
                "review",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));
            if review.cards.is_empty() {
                lines.push(Line::from("No cards found for selected deck."));
            } else {
                lines.push(Line::from("Finished review."));
            }
            lines.push(Line::from(""));
            if review.from_tree {
                lines.push(Line::from(Span::styled(
                    "enter/b: back | q: quit",
                    Style::default().fg(Color::DarkGray),
                )));
            } else if !review.decks.is_empty() {
                lines.push(Line::from(Span::styled(
                    "enter/b: back to decks | q: quit",
                    Style::default().fg(Color::DarkGray),
                )));
            } else {
                lines.push(Line::from(Span::styled(
                    "q: quit",
                    Style::default().fg(Color::DarkGray),
                )));
            }
        }
        ReviewStage::Review => {
            let mode_label = match review.mode.as_str() {
                "flashcard" => "Flashcard",
                "mcq" => "MCQ",
                _ => "Auto",
            };
            let deck_name = if review.deck_cursor < review.decks.len() {
                &review.decks[review.deck_cursor].name
            } else {
                "Review"
            };

            lines.push(Line::from(Span::styled(
                "review",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )));

            // Pagination dots
            let max_dots: usize = 40;
            let total = review.cards.len();
            let (mut dot_start, mut dot_end) = (0, total);
            let mut left_ellipsis = false;
            let mut right_ellipsis = false;
            if total > max_dots {
                let half = max_dots / 2;
                dot_start = review.card_cursor.saturating_sub(half);
                dot_end = dot_start + max_dots;
                if dot_end > total {
                    dot_end = total;
                    dot_start = total.saturating_sub(max_dots);
                }
                if dot_start > 0 {
                    left_ellipsis = true;
                }
                if dot_end < total {
                    right_ellipsis = true;
                }
            }

            let mut dot_spans = Vec::new();
            if left_ellipsis {
                dot_spans.push(Span::styled("…", Style::default().fg(Color::DarkGray)));
            }
            for idx in dot_start..dot_end {
                let is_cur = idx == review.card_cursor;
                let cov = review.covered_ids.contains(&review.cards[idx].id);
                let color = if is_cur {
                    if cov {
                        Color::Green
                    } else {
                        Color::White
                    }
                } else if cov {
                    Color::LightGreen
                } else {
                    Color::DarkGray
                };
                let style = if is_cur {
                    Style::default().fg(color).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(color)
                };
                dot_spans.push(Span::styled("•", style));
            }
            if right_ellipsis {
                dot_spans.push(Span::styled("…", Style::default().fg(Color::DarkGray)));
            }
            lines.push(Line::from(dot_spans));

            // Progress
            let is_covered = review
                .current_card()
                .map(|c| review.covered_ids.contains(&c.id))
                .unwrap_or(false);
            let progress_style = if is_covered {
                Style::default().fg(Color::Green)
            } else {
                Style::default()
            };
            lines.push(Line::from(vec![
                Span::styled(
                    format!("[{}/{}]", review.card_cursor + 1, review.cards.len()),
                    progress_style,
                ),
                Span::raw(format!(" [{mode_label}] {deck_name}")),
            ]));
            lines.push(Line::from(""));

            // Question
            if let Some(card) = review.current_card() {
                lines.push(Line::from(Span::styled(
                    &card.question,
                    Style::default().add_modifier(Modifier::BOLD),
                )));

                let effective = review.effective_mode();

                // MCQ choices
                if effective == "mcq" && !card.choices.is_empty() {
                    lines.push(Line::from(""));
                    for (i, choice) in card.choices.iter().enumerate() {
                        let selected = i == review.choice_cursor;
                        let style = if review.show_answer && card.correct_index == Some(i as i64) {
                            Style::default()
                                .fg(Color::Green)
                                .add_modifier(Modifier::BOLD)
                        } else if review.show_answer && selected {
                            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)
                        } else if selected {
                            Style::default()
                                .fg(Color::Magenta)
                                .add_modifier(Modifier::BOLD)
                        } else {
                            Style::default()
                        };
                        let prefix = if selected { "> " } else { "  " };
                        lines.push(Line::from(Span::styled(format!("{prefix}{choice}"), style)));
                    }
                }

                // Answer
                if review.show_answer {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(
                        "Answer",
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::BOLD),
                    )));
                    // Answer text: prefer correct choice if MCQ
                    let answer_text = if let Some(ci) = card.correct_index {
                        if ci >= 0 && (ci as usize) < card.choices.len() {
                            card.choices[ci as usize].clone()
                        } else {
                            card.answer.clone()
                        }
                    } else {
                        card.answer.clone()
                    };
                    lines.push(Line::from(Span::styled(
                        answer_text,
                        Style::default().fg(Color::Green),
                    )));

                    if !card.extra.trim().is_empty() {
                        lines.push(Line::from(""));
                        lines.push(Line::from(&*card.extra));
                    }
                }
            }

            lines.push(Line::from(""));
            let effective = review.effective_mode();
            let mut help = if effective == "mcq" {
                "enter/space: reveal→next | j/k: choice | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit".to_string()
            } else {
                "enter/space: reveal→next | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit"
                    .to_string()
            };
            if review.decks.len() > 1 {
                help.push_str(" | b: decks");
            }
            lines.push(Line::from(Span::styled(
                help,
                Style::default().fg(Color::DarkGray),
            )));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(Block::default().padding(ratatui::widgets::Padding::horizontal(2)))
        .wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}
