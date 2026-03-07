package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/raulsaavedra/cli-core/pkg/sqliteutil"

	_ "modernc.org/sqlite"
)

// --- Types ---

type Store struct {
	DB *sql.DB
}

type Skill struct {
	ID          int64      `json:"id"`
	ParentID    *int64     `json:"parent_id,omitempty"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Level       int        `json:"level"`
	Children    []Skill    `json:"children,omitempty"`
	Decks       []Deck     `json:"decks,omitempty"`
	Scenarios   []Scenario `json:"scenarios,omitempty"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
}

type Scenario struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	RepoPath    string  `json:"repo_path,omitempty"`
	Status      string  `json:"status"`
	Skills      []Skill `json:"skills,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	CompletedAt string  `json:"completed_at,omitempty"`
}

type SkillUpdate struct {
	Name        *string
	Description *string
	Level       *int
}

type ScenarioUpdate struct {
	Name        *string
	Description *string
	RepoPath    *string
	Status      *string
}

type Context struct {
	Skills          []Skill    `json:"skills"`
	ActiveScenarios []Scenario `json:"active_scenarios"`
}

type Deck struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	CardCount    int    `json:"card_count"`
	CoveredCount int    `json:"covered_count"`
	UpdatedAt    string `json:"updated_at"`
}

type Card struct {
	ID           int64    `json:"id"`
	DeckID       int64    `json:"deck_id"`
	Question     string   `json:"question"`
	Answer       string   `json:"answer"`
	Extra        string   `json:"extra"`
	Choices      []string `json:"choices"`
	CorrectIndex *int     `json:"correct_index"`
	Tags         []string `json:"tags"`
}

type CardUpdate struct {
	Question     *string
	Answer       *string
	Extra        *string
	Choices      *[]string
	CorrectIndex *int
	Tags         *[]string
}

// --- Open / Close ---

// migrateOldDataDir moves ~/.skill-builder/ to ~/.skill-tree/ if the new dir
// doesn't exist yet but the old one does (one-time rename migration).
func migrateOldDataDir() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	oldDir := filepath.Join(home, ".skill-builder")
	newDir := filepath.Join(home, ".skill-tree")
	if _, err := os.Stat(newDir); err == nil {
		return // new dir already exists
	}
	if _, err := os.Stat(oldDir); err != nil {
		return // old dir doesn't exist either
	}
	// Rename old DB file inside old dir, then rename the dir itself.
	oldDB := filepath.Join(oldDir, "skill-builder.db")
	newDB := filepath.Join(oldDir, "skill-tree.db")
	if _, err := os.Stat(oldDB); err == nil {
		_ = os.Rename(oldDB, newDB)
	}
	_ = os.Rename(oldDir, newDir)
}

func Open() (*Store, string, error) {
	migrateOldDataDir()
	db, path, err := sqliteutil.OpenSQLite(sqliteutil.OpenOptions{
		AppName:  "skill-tree",
		Filename: "skill-tree.db",
		Pragmas:  []string{"foreign_keys = ON"},
		Migrate:  migrate,
	})
	if err != nil {
		return nil, "", err
	}
	return &Store{DB: db}, path, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// --- Migration ---

func migrate(db *sql.DB) error {
	stmts := []string{
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
		// Triggers
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
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}

// --- Skill CRUD ---

func (s *Store) CreateSkill(name, description string, parentID *int64, level int) (int64, error) {
	res, err := s.DB.Exec(
		`INSERT INTO skills(name, description, parent_id, level) VALUES(?, ?, ?, ?)`,
		name, nullIfEmpty(description), parentID, level,
	)
	if err != nil {
		return 0, fmt.Errorf("create skill: %w", err)
	}
	return res.LastInsertId()
}

func (s *Store) ListSkills(parentID *int64) ([]Skill, error) {
	var rows *sql.Rows
	var err error
	if parentID == nil {
		rows, err = s.DB.Query(`
			SELECT id, parent_id, name, COALESCE(description,''), level, created_at, updated_at
			FROM skills
			WHERE parent_id IS NULL
			ORDER BY name ASC
		`)
	} else {
		rows, err = s.DB.Query(`
			SELECT id, parent_id, name, COALESCE(description,''), level, created_at, updated_at
			FROM skills
			WHERE parent_id = ?
			ORDER BY name ASC
		`, *parentID)
	}
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	defer rows.Close()

	out := []Skill{}
	for rows.Next() {
		var sk Skill
		var pid sql.NullInt64
		if err := rows.Scan(&sk.ID, &pid, &sk.Name, &sk.Description, &sk.Level, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return nil, fmt.Errorf("list skills scan: %w", err)
		}
		if pid.Valid {
			sk.ParentID = &pid.Int64
		}
		out = append(out, sk)
	}
	return out, rows.Err()
}

func (s *Store) GetSkill(id int64) (*Skill, error) {
	var sk Skill
	var pid sql.NullInt64
	err := s.DB.QueryRow(`
		SELECT id, parent_id, name, COALESCE(description,''), level, created_at, updated_at
		FROM skills WHERE id = ?
	`, id).Scan(&sk.ID, &pid, &sk.Name, &sk.Description, &sk.Level, &sk.CreatedAt, &sk.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get skill %d: %w", id, err)
	}
	if pid.Valid {
		sk.ParentID = &pid.Int64
	}

	if err := s.loadSkillLinks(&sk); err != nil {
		return nil, err
	}

	// Load children with their links
	children, err := s.getChildSkills(id)
	if err != nil {
		return nil, err
	}
	sk.Children = children

	return &sk, nil
}

func (s *Store) getChildSkills(parentID int64) ([]Skill, error) {
	rows, err := s.DB.Query(`
		SELECT id, parent_id, name, COALESCE(description,''), level, created_at, updated_at
		FROM skills WHERE parent_id = ?
		ORDER BY name ASC
	`, parentID)
	if err != nil {
		return nil, fmt.Errorf("get child skills: %w", err)
	}
	defer rows.Close()

	var children []Skill
	for rows.Next() {
		var sk Skill
		var pid sql.NullInt64
		if err := rows.Scan(&sk.ID, &pid, &sk.Name, &sk.Description, &sk.Level, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return nil, fmt.Errorf("get child skills scan: %w", err)
		}
		if pid.Valid {
			sk.ParentID = &pid.Int64
		}
		children = append(children, sk)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range children {
		if err := s.loadSkillLinks(&children[i]); err != nil {
			return nil, err
		}
	}
	return children, nil
}

func (s *Store) loadSkillLinks(sk *Skill) error {
	// Linked decks
	drows, err := s.DB.Query(`
		SELECT d.id, d.name, COALESCE(d.description,''), COUNT(c.id), COUNT(cc.card_id), d.updated_at
		FROM deck_skills ds
		JOIN decks d ON d.id = ds.deck_id
		LEFT JOIN cards c ON c.deck_id = d.id
		LEFT JOIN card_coverage cc ON cc.card_id = c.id
		WHERE ds.skill_id = ?
		GROUP BY d.id
		ORDER BY d.name
	`, sk.ID)
	if err != nil {
		return fmt.Errorf("get skill decks: %w", err)
	}
	defer drows.Close()
	sk.Decks = []Deck{}
	for drows.Next() {
		var d Deck
		if err := drows.Scan(&d.ID, &d.Name, &d.Description, &d.CardCount, &d.CoveredCount, &d.UpdatedAt); err != nil {
			return fmt.Errorf("get skill decks scan: %w", err)
		}
		sk.Decks = append(sk.Decks, d)
	}
	if err := drows.Err(); err != nil {
		return err
	}

	// Linked scenarios
	srows, err := s.DB.Query(`
		SELECT sc.id, sc.name, COALESCE(sc.description,''), COALESCE(sc.repo_path,''),
		       sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'')
		FROM scenario_skills ss
		JOIN scenarios sc ON sc.id = ss.scenario_id
		WHERE ss.skill_id = ?
		ORDER BY sc.name
	`, sk.ID)
	if err != nil {
		return fmt.Errorf("get skill scenarios: %w", err)
	}
	defer srows.Close()
	sk.Scenarios = []Scenario{}
	for srows.Next() {
		var sc Scenario
		if err := srows.Scan(&sc.ID, &sc.Name, &sc.Description, &sc.RepoPath, &sc.Status, &sc.CreatedAt, &sc.UpdatedAt, &sc.CompletedAt); err != nil {
			return fmt.Errorf("get skill scenarios scan: %w", err)
		}
		sk.Scenarios = append(sk.Scenarios, sc)
	}
	return srows.Err()
}

func (s *Store) UpdateSkill(id int64, update SkillUpdate) error {
	sets := []string{}
	args := []any{}
	if update.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *update.Name)
	}
	if update.Description != nil {
		sets = append(sets, "description = ?")
		if *update.Description == "" {
			args = append(args, nil)
		} else {
			args = append(args, *update.Description)
		}
	}
	if update.Level != nil {
		sets = append(sets, "level = ?")
		args = append(args, *update.Level)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	query := fmt.Sprintf("UPDATE skills SET %s WHERE id = ?", strings.Join(sets, ", "))
	res, err := s.DB.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("update skill: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("skill %d not found", id)
	}
	return nil
}

func (s *Store) DeleteSkill(id int64) error {
	res, err := s.DB.Exec(`DELETE FROM skills WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("skill %d not found", id)
	}
	return nil
}

func (s *Store) SkillTree() ([]Skill, error) {
	rows, err := s.DB.Query(`
		SELECT id, parent_id, name, COALESCE(description,''), level, created_at, updated_at
		FROM skills
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("skill tree: %w", err)
	}
	defer rows.Close()

	all := []Skill{}
	for rows.Next() {
		var sk Skill
		var pid sql.NullInt64
		if err := rows.Scan(&sk.ID, &pid, &sk.Name, &sk.Description, &sk.Level, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return nil, fmt.Errorf("skill tree scan: %w", err)
		}
		if pid.Valid {
			sk.ParentID = &pid.Int64
		}
		all = append(all, sk)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return buildTree(all), nil
}

func buildTree(all []Skill) []Skill {
	byID := make(map[int64]*Skill, len(all))
	for i := range all {
		all[i].Children = []Skill{}
		byID[all[i].ID] = &all[i]
	}

	var roots []Skill
	for i := range all {
		if all[i].ParentID != nil {
			if parent, ok := byID[*all[i].ParentID]; ok {
				parent.Children = append(parent.Children, all[i])
			}
		} else {
			roots = append(roots, all[i])
		}
	}

	// Recursively populate children from the map so nested levels are correct
	var populate func(skills []Skill) []Skill
	populate = func(skills []Skill) []Skill {
		for i := range skills {
			if node, ok := byID[skills[i].ID]; ok {
				skills[i].Children = populate(node.Children)
			}
		}
		return skills
	}
	return populate(roots)
}

func (s *Store) FullContext() (*Context, error) {
	tree, err := s.SkillTree()
	if err != nil {
		return nil, fmt.Errorf("full context tree: %w", err)
	}

	// Load deck links: skill_id -> []Deck
	deckLinks := map[int64][]Deck{}
	drows, err := s.DB.Query(`
		SELECT ds.skill_id, d.id, d.name, COALESCE(d.description,''), COUNT(c.id), COUNT(cc.card_id), d.updated_at
		FROM deck_skills ds
		JOIN decks d ON d.id = ds.deck_id
		LEFT JOIN cards c ON c.deck_id = d.id
		LEFT JOIN card_coverage cc ON cc.card_id = c.id
		GROUP BY ds.skill_id, d.id
		ORDER BY d.name
	`)
	if err != nil {
		return nil, fmt.Errorf("full context decks: %w", err)
	}
	defer drows.Close()
	for drows.Next() {
		var skillID int64
		var d Deck
		if err := drows.Scan(&skillID, &d.ID, &d.Name, &d.Description, &d.CardCount, &d.CoveredCount, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("full context decks scan: %w", err)
		}
		deckLinks[skillID] = append(deckLinks[skillID], d)
	}
	if err := drows.Err(); err != nil {
		return nil, err
	}

	// Load scenario links: skill_id -> []Scenario
	scenarioLinks := map[int64][]Scenario{}
	srows, err := s.DB.Query(`
		SELECT ss.skill_id, sc.id, sc.name, COALESCE(sc.description,''), COALESCE(sc.repo_path,''),
		       sc.status, sc.created_at, sc.updated_at, COALESCE(sc.completed_at,'')
		FROM scenario_skills ss
		JOIN scenarios sc ON sc.id = ss.scenario_id
		ORDER BY sc.name
	`)
	if err != nil {
		return nil, fmt.Errorf("full context scenarios: %w", err)
	}
	defer srows.Close()
	for srows.Next() {
		var skillID int64
		var sc Scenario
		if err := srows.Scan(&skillID, &sc.ID, &sc.Name, &sc.Description, &sc.RepoPath, &sc.Status, &sc.CreatedAt, &sc.UpdatedAt, &sc.CompletedAt); err != nil {
			return nil, fmt.Errorf("full context scenarios scan: %w", err)
		}
		scenarioLinks[skillID] = append(scenarioLinks[skillID], sc)
	}
	if err := srows.Err(); err != nil {
		return nil, err
	}

	// Attach decks and scenarios to tree nodes
	var attachLinks func(skills []Skill)
	attachLinks = func(skills []Skill) {
		for i := range skills {
			if decks, ok := deckLinks[skills[i].ID]; ok {
				skills[i].Decks = decks
			}
			if scenarios, ok := scenarioLinks[skills[i].ID]; ok {
				skills[i].Scenarios = scenarios
			}
			attachLinks(skills[i].Children)
		}
	}
	attachLinks(tree)

	// Active scenarios (planned or in_progress)
	activeRows, err := s.DB.Query(`
		SELECT id, name, COALESCE(description,''), COALESCE(repo_path,''),
		       status, created_at, updated_at, COALESCE(completed_at,'')
		FROM scenarios
		WHERE status IN ('planned', 'in_progress')
		ORDER BY status DESC, name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("full context active scenarios: %w", err)
	}
	defer activeRows.Close()
	active := []Scenario{}
	for activeRows.Next() {
		var sc Scenario
		if err := activeRows.Scan(&sc.ID, &sc.Name, &sc.Description, &sc.RepoPath, &sc.Status, &sc.CreatedAt, &sc.UpdatedAt, &sc.CompletedAt); err != nil {
			return nil, fmt.Errorf("full context active scenarios scan: %w", err)
		}
		active = append(active, sc)
	}
	if err := activeRows.Err(); err != nil {
		return nil, err
	}

	return &Context{
		Skills:          tree,
		ActiveScenarios: active,
	}, nil
}

// --- Deck CRUD ---

func (s *Store) CreateDeck(name, description string) (int64, error) {
	res, err := s.DB.Exec(`INSERT INTO decks(name, description) VALUES(?, ?)`, name, description)
	if err != nil {
		return 0, fmt.Errorf("create deck: %w", err)
	}
	return res.LastInsertId()
}

func (s *Store) CreateDeckWithContents(name, description string, skillIDs []int64, cards []Card) (int64, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("create deck begin: %w", err)
	}
	defer tx.Rollback()

	deckID, err := createDeckTx(tx, name, description)
	if err != nil {
		return 0, err
	}
	for _, skillID := range skillIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?, ?)`, deckID, skillID); err != nil {
			return 0, fmt.Errorf("create deck link skill: %w", err)
		}
	}
	for _, card := range cards {
		if _, err := insertCardTx(tx, deckID, card); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("create deck commit: %w", err)
	}
	return deckID, nil
}

func (s *Store) ListDecks() ([]Deck, error) {
	rows, err := s.DB.Query(`
		SELECT d.id, d.name, COALESCE(d.description,''),
		       COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
		FROM decks d
		LEFT JOIN cards c ON c.deck_id = d.id
		LEFT JOIN card_coverage cc ON cc.card_id = c.id
		GROUP BY d.id
		ORDER BY d.name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list decks: %w", err)
	}
	defer rows.Close()
	out := []Deck{}
	for rows.Next() {
		var d Deck
		if err := rows.Scan(&d.ID, &d.Name, &d.Description, &d.CardCount, &d.CoveredCount, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("list decks scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) GetDeckByName(name string) (*Deck, error) {
	var d Deck
	err := s.DB.QueryRow(`
		SELECT d.id, d.name, COALESCE(d.description,''),
		       COUNT(c.id) AS card_count, COUNT(cc.card_id) AS covered_count, d.updated_at
		FROM decks d
		LEFT JOIN cards c ON c.deck_id = d.id
		LEFT JOIN card_coverage cc ON cc.card_id = c.id
		WHERE d.name = ?
		GROUP BY d.id
	`, name).Scan(&d.ID, &d.Name, &d.Description, &d.CardCount, &d.CoveredCount, &d.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get deck by name %q: %w", name, err)
	}
	return &d, nil
}

func (s *Store) DeleteDeckByID(id int64) error {
	res, err := s.DB.Exec(`DELETE FROM decks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete deck: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("deck %d not found", id)
	}
	return nil
}

// --- Coverage ---

// MarkCardCovered records that a card has been correctly answered.
// Idempotent: does nothing if the card is already covered.
func (s *Store) MarkCardCovered(cardID int64) error {
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO card_coverage(card_id) VALUES(?)`, cardID)
	if err != nil {
		return fmt.Errorf("mark card covered: %w", err)
	}
	return nil
}

// DeckCoverage returns (coveredCount, totalCount) for a deck.
func (s *Store) DeckCoverage(deckID int64) (int, int, error) {
	var total, covered int
	err := s.DB.QueryRow(`
		SELECT COUNT(c.id), COUNT(cc.card_id)
		FROM cards c
		LEFT JOIN card_coverage cc ON cc.card_id = c.id
		WHERE c.deck_id = ?
	`, deckID).Scan(&total, &covered)
	if err != nil {
		return 0, 0, fmt.Errorf("deck coverage %d: %w", deckID, err)
	}
	return covered, total, nil
}

// CoveredCardIDs returns the set of card IDs that are covered from the given list.
func (s *Store) CoveredCardIDs(cardIDs []int64) (map[int64]bool, error) {
	if len(cardIDs) == 0 {
		return map[int64]bool{}, nil
	}
	placeholders := make([]string, len(cardIDs))
	args := make([]any, len(cardIDs))
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	query := `SELECT card_id FROM card_coverage WHERE card_id IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("covered card ids: %w", err)
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("covered card ids scan: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// CompleteDeckCoverage marks all cards in a deck as covered.
func (s *Store) CompleteDeckCoverage(deckID int64) error {
	_, err := s.DB.Exec(`
		INSERT OR IGNORE INTO card_coverage(card_id)
		SELECT id FROM cards WHERE deck_id = ?
	`, deckID)
	if err != nil {
		return fmt.Errorf("complete deck coverage %d: %w", deckID, err)
	}
	return nil
}

// ResetDeckCoverage deletes all coverage records for cards in a deck.
func (s *Store) ResetDeckCoverage(deckID int64) error {
	_, err := s.DB.Exec(`
		DELETE FROM card_coverage
		WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)
	`, deckID)
	if err != nil {
		return fmt.Errorf("reset deck coverage %d: %w", deckID, err)
	}
	return nil
}

// --- Card CRUD ---

func (s *Store) InsertCard(deckID int64, card Card) (int64, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("insert card begin: %w", err)
	}
	defer tx.Rollback()

	id, err := insertCardTx(tx, deckID, card)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("insert card commit: %w", err)
	}
	return id, nil
}

func (s *Store) InsertCards(deckID int64, cards []Card) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return fmt.Errorf("insert cards begin: %w", err)
	}
	defer tx.Rollback()

	for _, card := range cards {
		if _, err := insertCardTx(tx, deckID, card); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("insert cards commit: %w", err)
	}
	return nil
}

func insertCardTx(tx *sql.Tx, deckID int64, card Card) (int64, error) {
	choicesValue := encodeChoices(card.Choices)
	var extraValue any
	if card.Extra == "" {
		extraValue = nil
	} else {
		extraValue = card.Extra
	}

	res, err := tx.Exec(
		`INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?, ?, ?, ?, ?, ?)`,
		deckID, card.Question, card.Answer, extraValue, choicesValue, card.CorrectIndex,
	)
	if err != nil {
		return 0, fmt.Errorf("insert card: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err := replaceCardTagsTx(tx, id, card.Tags); err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) ListCards(deckID int64, limit int) ([]Card, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.DB.Query(`
		SELECT id, deck_id, question, answer, COALESCE(extra,''), choices, correct_index
		FROM cards
		WHERE deck_id = ?
		ORDER BY id
		LIMIT ?
	`, deckID, limit)
	if err != nil {
		return nil, fmt.Errorf("list cards: %w", err)
	}
	defer rows.Close()
	out := []Card{}
	cardIDs := []int64{}
	for rows.Next() {
		card, err := scanCard(rows)
		if err != nil {
			return nil, fmt.Errorf("list cards scan: %w", err)
		}
		out = append(out, card)
		cardIDs = append(cardIDs, card.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tagsByCard, err := s.tagsForCards(cardIDs)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Tags = tagsByCard[out[i].ID]
	}
	return out, nil
}

func (s *Store) GetCard(deckID, cardID int64) (*Card, error) {
	row := s.DB.QueryRow(`
		SELECT id, deck_id, question, answer, COALESCE(extra,''), choices, correct_index
		FROM cards
		WHERE deck_id = ? AND id = ?
	`, deckID, cardID)
	card, err := scanCard(row)
	if err != nil {
		return nil, fmt.Errorf("get card %d: %w", cardID, err)
	}
	card.Tags, _ = s.tagsForCard(card.ID)
	return &card, nil
}

func (s *Store) UpdateCard(deckID, cardID int64, update CardUpdate) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return fmt.Errorf("update card begin: %w", err)
	}
	defer tx.Rollback()

	sets := []string{}
	args := []any{}
	if update.Question != nil {
		sets = append(sets, "question = ?")
		args = append(args, *update.Question)
	}
	if update.Answer != nil {
		sets = append(sets, "answer = ?")
		args = append(args, *update.Answer)
	}
	if update.Extra != nil {
		sets = append(sets, "extra = ?")
		if *update.Extra == "" {
			args = append(args, nil)
		} else {
			args = append(args, *update.Extra)
		}
	}
	if update.Choices != nil {
		sets = append(sets, "choices = ?")
		args = append(args, encodeChoices(*update.Choices))
	}
	if update.CorrectIndex != nil {
		sets = append(sets, "correct_index = ?")
		args = append(args, *update.CorrectIndex)
	}

	if len(sets) > 0 {
		args = append(args, deckID, cardID)
		query := fmt.Sprintf("UPDATE cards SET %s, updated_at = CURRENT_TIMESTAMP WHERE deck_id = ? AND id = ?", strings.Join(sets, ", "))
		res, err := tx.Exec(query, args...)
		if err != nil {
			return fmt.Errorf("update card: %w", err)
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return fmt.Errorf("card %d not found in deck", cardID)
		}
	} else if update.Tags != nil {
		if err := ensureCardTx(tx, deckID, cardID); err != nil {
			return err
		}
	}

	if update.Tags != nil {
		if err := replaceCardTagsTx(tx, cardID, *update.Tags); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("update card commit: %w", err)
	}
	return nil
}

func (s *Store) DeleteCard(deckID, cardID int64) error {
	res, err := s.DB.Exec(`DELETE FROM cards WHERE deck_id = ? AND id = ?`, deckID, cardID)
	if err != nil {
		return fmt.Errorf("delete card: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("card %d not found in deck", cardID)
	}
	return nil
}

// --- Card helpers ---

func (s *Store) tagsForCard(cardID int64) ([]string, error) {
	rows, err := s.DB.Query(`SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}

func (s *Store) tagsForCards(cardIDs []int64) (map[int64][]string, error) {
	if len(cardIDs) == 0 {
		return map[int64][]string{}, nil
	}

	placeholders := make([]string, len(cardIDs))
	args := make([]any, len(cardIDs))
	for i, cardID := range cardIDs {
		placeholders[i] = "?"
		args[i] = cardID
	}

	rows, err := s.DB.Query(
		fmt.Sprintf(`SELECT card_id, tag FROM card_tags WHERE card_id IN (%s) ORDER BY card_id, tag`, strings.Join(placeholders, ",")),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[int64][]string{}
	for rows.Next() {
		var cardID int64
		var tag string
		if err := rows.Scan(&cardID, &tag); err != nil {
			return nil, err
		}
		out[cardID] = append(out[cardID], tag)
	}
	return out, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanCard(s scanner) (Card, error) {
	var card Card
	var choicesRaw sql.NullString
	var correctIndex sql.NullInt64
	err := s.Scan(
		&card.ID,
		&card.DeckID,
		&card.Question,
		&card.Answer,
		&card.Extra,
		&choicesRaw,
		&correctIndex,
	)
	if err != nil {
		return Card{}, err
	}
	card.Choices = decodeChoices(choicesRaw)
	if correctIndex.Valid {
		idx := int(correctIndex.Int64)
		card.CorrectIndex = &idx
	}
	return card, nil
}

const choiceSeparator = "|␟|"

func encodeChoices(choices []string) any {
	if len(choices) == 0 {
		return nil
	}
	return strings.Join(choices, choiceSeparator)
}

func decodeChoices(raw sql.NullString) []string {
	if !raw.Valid || raw.String == "" {
		return []string{}
	}
	value := raw.String
	if strings.HasPrefix(strings.TrimSpace(value), "[") {
		var parsed []string
		if err := json.Unmarshal([]byte(value), &parsed); err == nil {
			return parsed
		}
	}
	return strings.Split(value, choiceSeparator)
}

func (s *Store) ensureCard(deckID, cardID int64) error {
	var exists int
	err := s.DB.QueryRow(`SELECT 1 FROM cards WHERE deck_id = ? AND id = ?`, deckID, cardID).Scan(&exists)
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("card %d not found in deck", cardID)
	}
	return err
}

func ensureCardTx(tx *sql.Tx, deckID, cardID int64) error {
	var exists int
	err := tx.QueryRow(`SELECT 1 FROM cards WHERE deck_id = ? AND id = ?`, deckID, cardID).Scan(&exists)
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("card %d not found in deck", cardID)
	}
	return err
}

func createDeckTx(tx *sql.Tx, name, description string) (int64, error) {
	res, err := tx.Exec(`INSERT INTO decks(name, description) VALUES(?, ?)`, name, description)
	if err != nil {
		return 0, fmt.Errorf("create deck: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return id, nil
}

func replaceCardTagsTx(tx *sql.Tx, cardID int64, tags []string) error {
	if _, err := tx.Exec(`DELETE FROM card_tags WHERE card_id = ?`, cardID); err != nil {
		return fmt.Errorf("replace card tags delete: %w", err)
	}
	for _, tag := range tags {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?, ?)`, cardID, tag); err != nil {
			return fmt.Errorf("replace card tags insert: %w", err)
		}
	}
	return nil
}

// --- Scenario CRUD ---

func (s *Store) CreateScenario(name, description, repoPath string, skillIDs []int64) (int64, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("create scenario begin: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO scenarios(name, description, repo_path) VALUES(?, ?, ?)`,
		name, nullIfEmpty(description), nullIfEmpty(repoPath),
	)
	if err != nil {
		return 0, fmt.Errorf("create scenario: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, sid := range skillIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?, ?)`, id, sid); err != nil {
			return 0, fmt.Errorf("link scenario skill: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("create scenario commit: %w", err)
	}
	return id, nil
}

func (s *Store) ListScenarios(status string) ([]Scenario, error) {
	var rows *sql.Rows
	var err error
	if status == "" {
		rows, err = s.DB.Query(`
			SELECT id, name, COALESCE(description,''), COALESCE(repo_path,''),
			       status, created_at, updated_at, COALESCE(completed_at,'')
			FROM scenarios
			ORDER BY name ASC
		`)
	} else {
		rows, err = s.DB.Query(`
			SELECT id, name, COALESCE(description,''), COALESCE(repo_path,''),
			       status, created_at, updated_at, COALESCE(completed_at,'')
			FROM scenarios
			WHERE status = ?
			ORDER BY name ASC
		`, status)
	}
	if err != nil {
		return nil, fmt.Errorf("list scenarios: %w", err)
	}
	defer rows.Close()

	out := []Scenario{}
	for rows.Next() {
		var sc Scenario
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Description, &sc.RepoPath, &sc.Status, &sc.CreatedAt, &sc.UpdatedAt, &sc.CompletedAt); err != nil {
			return nil, fmt.Errorf("list scenarios scan: %w", err)
		}
		out = append(out, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Skills, err = s.skillsForScenario(out[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) GetScenario(id int64) (*Scenario, error) {
	var sc Scenario
	err := s.DB.QueryRow(`
		SELECT id, name, COALESCE(description,''), COALESCE(repo_path,''),
		       status, created_at, updated_at, COALESCE(completed_at,'')
		FROM scenarios WHERE id = ?
	`, id).Scan(&sc.ID, &sc.Name, &sc.Description, &sc.RepoPath, &sc.Status, &sc.CreatedAt, &sc.UpdatedAt, &sc.CompletedAt)
	if err != nil {
		return nil, fmt.Errorf("get scenario %d: %w", id, err)
	}
	sc.Skills, err = s.skillsForScenario(id)
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

func (s *Store) UpdateScenario(id int64, update ScenarioUpdate) error {
	sets := []string{}
	args := []any{}
	if update.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *update.Name)
	}
	if update.Description != nil {
		sets = append(sets, "description = ?")
		if *update.Description == "" {
			args = append(args, nil)
		} else {
			args = append(args, *update.Description)
		}
	}
	if update.RepoPath != nil {
		sets = append(sets, "repo_path = ?")
		if *update.RepoPath == "" {
			args = append(args, nil)
		} else {
			args = append(args, *update.RepoPath)
		}
	}
	if update.Status != nil {
		sets = append(sets, "status = ?")
		args = append(args, *update.Status)
		if *update.Status == "completed" {
			sets = append(sets, "completed_at = CURRENT_TIMESTAMP")
		}
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	query := fmt.Sprintf("UPDATE scenarios SET %s WHERE id = ?", strings.Join(sets, ", "))
	res, err := s.DB.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("update scenario: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("scenario %d not found", id)
	}
	return nil
}

func (s *Store) DeleteScenario(id int64) error {
	res, err := s.DB.Exec(`DELETE FROM scenarios WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete scenario: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("scenario %d not found", id)
	}
	return nil
}

func (s *Store) skillsForScenario(scenarioID int64) ([]Skill, error) {
	rows, err := s.DB.Query(`
		SELECT sk.id, sk.parent_id, sk.name, COALESCE(sk.description,''), sk.level, sk.created_at, sk.updated_at
		FROM scenario_skills ss
		JOIN skills sk ON sk.id = ss.skill_id
		WHERE ss.scenario_id = ?
		ORDER BY sk.name
	`, scenarioID)
	if err != nil {
		return nil, fmt.Errorf("skills for scenario %d: %w", scenarioID, err)
	}
	defer rows.Close()
	out := []Skill{}
	for rows.Next() {
		var sk Skill
		var pid sql.NullInt64
		if err := rows.Scan(&sk.ID, &pid, &sk.Name, &sk.Description, &sk.Level, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return nil, err
		}
		if pid.Valid {
			sk.ParentID = &pid.Int64
		}
		out = append(out, sk)
	}
	return out, rows.Err()
}

// --- Junction table operations ---

func (s *Store) LinkDeckSkill(deckID, skillID int64) error {
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO deck_skills(deck_id, skill_id) VALUES(?, ?)`, deckID, skillID)
	if err != nil {
		return fmt.Errorf("link deck skill: %w", err)
	}
	return nil
}

func (s *Store) UnlinkDeckSkill(deckID, skillID int64) error {
	_, err := s.DB.Exec(`DELETE FROM deck_skills WHERE deck_id = ? AND skill_id = ?`, deckID, skillID)
	if err != nil {
		return fmt.Errorf("unlink deck skill: %w", err)
	}
	return nil
}

func (s *Store) LinkScenarioSkill(scenarioID, skillID int64) error {
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO scenario_skills(scenario_id, skill_id) VALUES(?, ?)`, scenarioID, skillID)
	if err != nil {
		return fmt.Errorf("link scenario skill: %w", err)
	}
	return nil
}

func (s *Store) UnlinkScenarioSkill(scenarioID, skillID int64) error {
	_, err := s.DB.Exec(`DELETE FROM scenario_skills WHERE scenario_id = ? AND skill_id = ?`, scenarioID, skillID)
	if err != nil {
		return fmt.Errorf("unlink scenario skill: %w", err)
	}
	return nil
}

// --- Review by skill ---

func (s *Store) CardsForSkill(skillID int64, limit int) ([]Card, error) {
	if limit <= 0 {
		limit = 50
	}

	// Collect all descendant skill IDs recursively
	skillIDs, err := s.descendantSkillIDs(skillID)
	if err != nil {
		return nil, fmt.Errorf("cards for skill descendants: %w", err)
	}
	skillIDs = append(skillIDs, skillID)

	// Build placeholders for IN clause
	placeholders := make([]string, len(skillIDs))
	args := make([]any, len(skillIDs))
	for i, sid := range skillIDs {
		placeholders[i] = "?"
		args[i] = sid
	}

	// Get all deck IDs linked to any of these skills
	drows, err := s.DB.Query(
		fmt.Sprintf(`SELECT DISTINCT deck_id FROM deck_skills WHERE skill_id IN (%s)`, strings.Join(placeholders, ",")),
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("cards for skill deck query: %w", err)
	}
	defer drows.Close()

	var deckIDs []int64
	for drows.Next() {
		var did int64
		if err := drows.Scan(&did); err != nil {
			return nil, err
		}
		deckIDs = append(deckIDs, did)
	}
	if err := drows.Err(); err != nil {
		return nil, err
	}

	if len(deckIDs) == 0 {
		return []Card{}, nil
	}

	// Load cards from those decks
	dPlaceholders := make([]string, len(deckIDs))
	dArgs := make([]any, len(deckIDs))
	for i, did := range deckIDs {
		dPlaceholders[i] = "?"
		dArgs[i] = did
	}
	dArgs = append(dArgs, limit)

	crows, err := s.DB.Query(
		fmt.Sprintf(`
			SELECT id, deck_id, question, answer, COALESCE(extra,''), choices, correct_index
			FROM cards
			WHERE deck_id IN (%s)
			ORDER BY id
			LIMIT ?
		`, strings.Join(dPlaceholders, ",")),
		dArgs...,
	)
	if err != nil {
		return nil, fmt.Errorf("cards for skill card query: %w", err)
	}
	defer crows.Close()

	out := []Card{}
	cardIDs := []int64{}
	for crows.Next() {
		card, err := scanCard(crows)
		if err != nil {
			return nil, err
		}
		out = append(out, card)
		cardIDs = append(cardIDs, card.ID)
	}
	if err := crows.Err(); err != nil {
		return nil, err
	}
	tagsByCard, err := s.tagsForCards(cardIDs)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Tags = tagsByCard[out[i].ID]
	}
	return out, nil
}

func (s *Store) descendantSkillIDs(parentID int64) ([]int64, error) {
	rows, err := s.DB.Query(`SELECT id FROM skills WHERE parent_id = ?`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var allDesc []int64
	allDesc = append(allDesc, ids...)
	for _, childID := range ids {
		desc, err := s.descendantSkillIDs(childID)
		if err != nil {
			return nil, err
		}
		allDesc = append(allDesc, desc...)
	}
	return allDesc, nil
}

// --- Import from quiz ---

func (s *Store) ImportFromQuiz(quizDBPath string) (int, int, error) {
	quizDB, err := sql.Open("sqlite", quizDBPath)
	if err != nil {
		return 0, 0, fmt.Errorf("open quiz db: %w", err)
	}
	defer quizDB.Close()

	// Read all decks from quiz DB
	drows, err := quizDB.Query(`SELECT id, name, COALESCE(description,'') FROM decks ORDER BY id`)
	if err != nil {
		return 0, 0, fmt.Errorf("import read decks: %w", err)
	}
	defer drows.Close()

	type quizDeck struct {
		id          int64
		name        string
		description string
	}
	var quizDecks []quizDeck
	for drows.Next() {
		var d quizDeck
		if err := drows.Scan(&d.id, &d.name, &d.description); err != nil {
			return 0, 0, fmt.Errorf("import scan deck: %w", err)
		}
		quizDecks = append(quizDecks, d)
	}
	if err := drows.Err(); err != nil {
		return 0, 0, err
	}

	existingDeckNames := map[string]bool{}
	existingDecks, err := s.ListDecks()
	if err != nil {
		return 0, 0, fmt.Errorf("import existing decks: %w", err)
	}
	for _, deck := range existingDecks {
		existingDeckNames[deck.Name] = true
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return 0, 0, fmt.Errorf("import begin: %w", err)
	}
	defer tx.Rollback()

	decksImported := 0
	cardsImported := 0

	for _, qd := range quizDecks {
		// Skip if deck name already exists
		if existingDeckNames[qd.name] {
			continue
		}

		newDeckID, err := createDeckTx(tx, qd.name, qd.description)
		if err != nil {
			return 0, 0, fmt.Errorf("import create deck %q: %w", qd.name, err)
		}
		existingDeckNames[qd.name] = true
		decksImported++

		// Read cards for this deck from quiz DB
		crows, err := quizDB.Query(`
			SELECT id, question, answer, COALESCE(extra,''), choices, correct_index
			FROM cards WHERE deck_id = ? ORDER BY id
		`, qd.id)
		if err != nil {
			return 0, 0, fmt.Errorf("import read cards: %w", err)
		}

		for crows.Next() {
			var cardID int64
			var question, answer, extra string
			var choicesRaw sql.NullString
			var correctIndex sql.NullInt64
			if err := crows.Scan(&cardID, &question, &answer, &extra, &choicesRaw, &correctIndex); err != nil {
				crows.Close()
				return 0, 0, fmt.Errorf("import scan card: %w", err)
			}

			choices := decodeChoices(choicesRaw)
			choicesValue := encodeChoices(choices)
			var extraValue any
			if extra == "" {
				extraValue = nil
			} else {
				extraValue = extra
			}
			var ciValue any
			if correctIndex.Valid {
				ciValue = correctIndex.Int64
			}

			cardRes, err := tx.Exec(
				`INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?, ?, ?, ?, ?, ?)`,
				newDeckID, question, answer, extraValue, choicesValue, ciValue,
			)
			if err != nil {
				crows.Close()
				return 0, 0, fmt.Errorf("import insert card: %w", err)
			}
			newCardID, _ := cardRes.LastInsertId()

			// Read and insert tags from quiz DB
			trows, err := quizDB.Query(`SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag`, cardID)
			if err == nil {
				for trows.Next() {
					var tag string
					if err := trows.Scan(&tag); err == nil {
						if _, err := tx.Exec(`INSERT OR IGNORE INTO card_tags(card_id, tag) VALUES(?, ?)`, newCardID, tag); err != nil {
							trows.Close()
							crows.Close()
							return 0, 0, fmt.Errorf("import insert tag: %w", err)
						}
					}
				}
				trows.Close()
			}

			cardsImported++
		}
		crows.Close()
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("import commit: %w", err)
	}
	return decksImported, cardsImported, nil
}

// --- Validation ---

// ValidateLevel returns an error if level is outside 0-5.
func ValidateLevel(level int) error {
	if level < 0 || level > 5 {
		return fmt.Errorf("level must be 0-5, got %d", level)
	}
	return nil
}

// ClampLevel constrains a level value to 0-5 for display purposes.
func ClampLevel(level int) int {
	if level < 0 {
		return 0
	}
	if level > 5 {
		return 5
	}
	return level
}

var validStatuses = map[string]bool{
	"planned":     true,
	"in_progress": true,
	"completed":   true,
	"abandoned":   true,
}

// ValidateStatus returns an error if status is not a valid scenario status.
func ValidateStatus(status string) error {
	if !validStatuses[status] {
		return fmt.Errorf("status must be one of: planned, in_progress, completed, abandoned; got %q", status)
	}
	return nil
}

// --- Helpers ---

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
