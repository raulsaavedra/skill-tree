package store

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	_ "modernc.org/sqlite"
)

func openTempStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "skill-tree.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if err := migrate(db); err != nil {
		_ = db.Close()
		t.Fatalf("migrate sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &Store{DB: db}
}

// openTempQuizDB creates a minimal quiz-style database with the same schema
// that ImportFromQuiz expects: decks, cards, card_tags.
func openTempQuizDB(t *testing.T) (db *sql.DB, path string) {
	t.Helper()
	path = filepath.Join(t.TempDir(), "quiz.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open quiz db: %v", err)
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS decks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS cards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deck_id INTEGER NOT NULL,
			question TEXT NOT NULL,
			answer TEXT NOT NULL,
			extra TEXT,
			choices TEXT,
			correct_index INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS card_tags (
			card_id INTEGER NOT NULL,
			tag TEXT NOT NULL,
			PRIMARY KEY(card_id, tag),
			FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
		)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			t.Fatalf("quiz migrate: %v", err)
		}
	}
	t.Cleanup(func() { db.Close() })
	return db, path
}

// --- 1. TestOpenTempStore ---

func TestOpenTempStore(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Verify tables exist by querying each one
	tables := []string{"skills", "decks", "cards", "card_tags", "scenarios", "scenario_skills", "deck_skills"}
	for _, tbl := range tables {
		var name string
		err := st.DB.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %q to exist: %v", tbl, err)
		}
	}
}

// --- 2. TestSkillCRUD ---

func TestSkillCRUD(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create root skill
	rootID, err := st.CreateSkill("Go", "Go programming", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill root: %v", err)
	}
	if rootID == 0 {
		t.Fatal("expected non-zero root ID")
	}

	// Create child skill
	childID, err := st.CreateSkill("Concurrency", "goroutines and channels", &rootID, 1)
	if err != nil {
		t.Fatalf("CreateSkill child: %v", err)
	}

	// Get root skill
	sk, err := st.GetSkill(rootID)
	if err != nil {
		t.Fatalf("GetSkill root: %v", err)
	}
	if sk.Name != "Go" {
		t.Fatalf("GetSkill name = %q, want %q", sk.Name, "Go")
	}
	if sk.Description != "Go programming" {
		t.Fatalf("GetSkill description = %q, want %q", sk.Description, "Go programming")
	}
	if sk.Level != 0 {
		t.Fatalf("GetSkill level = %d, want 0", sk.Level)
	}
	if sk.ParentID != nil {
		t.Fatalf("GetSkill parent_id = %v, want nil", sk.ParentID)
	}

	// Get child skill
	child, err := st.GetSkill(childID)
	if err != nil {
		t.Fatalf("GetSkill child: %v", err)
	}
	if child.ParentID == nil || *child.ParentID != rootID {
		t.Fatalf("GetSkill child parent_id = %v, want %d", child.ParentID, rootID)
	}

	// List root skills (parent_id IS NULL)
	roots, err := st.ListSkills(nil)
	if err != nil {
		t.Fatalf("ListSkills nil: %v", err)
	}
	if len(roots) != 1 {
		t.Fatalf("ListSkills nil count = %d, want 1", len(roots))
	}
	if roots[0].ID != rootID {
		t.Fatalf("ListSkills nil[0].ID = %d, want %d", roots[0].ID, rootID)
	}

	// List children of root
	children, err := st.ListSkills(&rootID)
	if err != nil {
		t.Fatalf("ListSkills rootID: %v", err)
	}
	if len(children) != 1 {
		t.Fatalf("ListSkills rootID count = %d, want 1", len(children))
	}
	if children[0].ID != childID {
		t.Fatalf("ListSkills rootID[0].ID = %d, want %d", children[0].ID, childID)
	}

	// Update root skill
	newName := "Golang"
	newLevel := 2
	if err := st.UpdateSkill(rootID, SkillUpdate{Name: &newName, Level: &newLevel}); err != nil {
		t.Fatalf("UpdateSkill: %v", err)
	}
	sk, err = st.GetSkill(rootID)
	if err != nil {
		t.Fatalf("GetSkill after update: %v", err)
	}
	if sk.Name != "Golang" {
		t.Fatalf("updated name = %q, want %q", sk.Name, "Golang")
	}
	if sk.Level != 2 {
		t.Fatalf("updated level = %d, want 2", sk.Level)
	}

	// Delete child skill
	if err := st.DeleteSkill(childID); err != nil {
		t.Fatalf("DeleteSkill child: %v", err)
	}
	children, err = st.ListSkills(&rootID)
	if err != nil {
		t.Fatalf("ListSkills after delete: %v", err)
	}
	if len(children) != 0 {
		t.Fatalf("ListSkills after delete count = %d, want 0", len(children))
	}

	// Delete root skill
	if err := st.DeleteSkill(rootID); err != nil {
		t.Fatalf("DeleteSkill root: %v", err)
	}
	roots, err = st.ListSkills(nil)
	if err != nil {
		t.Fatalf("ListSkills after delete root: %v", err)
	}
	if len(roots) != 0 {
		t.Fatalf("ListSkills after delete root count = %d, want 0", len(roots))
	}
}

// --- 3. TestSkillTree ---

func TestSkillTree(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create a 3-level hierarchy: Backend -> Go -> Concurrency
	backendID, err := st.CreateSkill("Backend", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill Backend: %v", err)
	}
	goID, err := st.CreateSkill("Go", "", &backendID, 1)
	if err != nil {
		t.Fatalf("CreateSkill Go: %v", err)
	}
	concID, err := st.CreateSkill("Concurrency", "", &goID, 2)
	if err != nil {
		t.Fatalf("CreateSkill Concurrency: %v", err)
	}

	// Create a sibling root
	frontendID, err := st.CreateSkill("Frontend", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill Frontend: %v", err)
	}

	tree, err := st.SkillTree()
	if err != nil {
		t.Fatalf("SkillTree: %v", err)
	}

	// Should have 2 roots: Backend and Frontend (alphabetical)
	if len(tree) != 2 {
		t.Fatalf("SkillTree root count = %d, want 2", len(tree))
	}
	if tree[0].ID != backendID {
		t.Fatalf("tree[0].ID = %d, want %d (Backend)", tree[0].ID, backendID)
	}
	if tree[1].ID != frontendID {
		t.Fatalf("tree[1].ID = %d, want %d (Frontend)", tree[1].ID, frontendID)
	}

	// Backend should have 1 child: Go
	if len(tree[0].Children) != 1 {
		t.Fatalf("Backend children = %d, want 1", len(tree[0].Children))
	}
	if tree[0].Children[0].ID != goID {
		t.Fatalf("Backend child ID = %d, want %d (Go)", tree[0].Children[0].ID, goID)
	}

	// Go should have 1 child: Concurrency
	goNode := tree[0].Children[0]
	if len(goNode.Children) != 1 {
		t.Fatalf("Go children = %d, want 1", len(goNode.Children))
	}
	if goNode.Children[0].ID != concID {
		t.Fatalf("Go child ID = %d, want %d (Concurrency)", goNode.Children[0].ID, concID)
	}

	// Frontend has no children
	if len(tree[1].Children) != 0 {
		t.Fatalf("Frontend children = %d, want 0", len(tree[1].Children))
	}
}

// --- 4. TestScenarioCRUD ---

func TestScenarioCRUD(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create skills to link
	skillID1, err := st.CreateSkill("Go", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill: %v", err)
	}
	skillID2, err := st.CreateSkill("REST", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill: %v", err)
	}

	// Create scenario with skill links
	scID, err := st.CreateScenario("Build API", "Build a REST API in Go", "/tmp/api-project", []int64{skillID1, skillID2})
	if err != nil {
		t.Fatalf("CreateScenario: %v", err)
	}
	if scID == 0 {
		t.Fatal("expected non-zero scenario ID")
	}

	// Get scenario - verify skills populated
	sc, err := st.GetScenario(scID)
	if err != nil {
		t.Fatalf("GetScenario: %v", err)
	}
	if sc.Name != "Build API" {
		t.Fatalf("scenario name = %q, want %q", sc.Name, "Build API")
	}
	if sc.Description != "Build a REST API in Go" {
		t.Fatalf("scenario description = %q, want %q", sc.Description, "Build a REST API in Go")
	}
	if sc.RepoPath != "/tmp/api-project" {
		t.Fatalf("scenario repo_path = %q, want %q", sc.RepoPath, "/tmp/api-project")
	}
	if sc.Status != "planned" {
		t.Fatalf("scenario status = %q, want %q", sc.Status, "planned")
	}
	if len(sc.Skills) != 2 {
		t.Fatalf("scenario skills count = %d, want 2", len(sc.Skills))
	}

	// Create another scenario without skills
	sc2ID, err := st.CreateScenario("Setup CI", "", "", nil)
	if err != nil {
		t.Fatalf("CreateScenario no skills: %v", err)
	}

	// List all scenarios (no filter)
	all, err := st.ListScenarios("")
	if err != nil {
		t.Fatalf("ListScenarios all: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("ListScenarios all count = %d, want 2", len(all))
	}

	// List with status filter
	planned, err := st.ListScenarios("planned")
	if err != nil {
		t.Fatalf("ListScenarios planned: %v", err)
	}
	if len(planned) != 2 {
		t.Fatalf("ListScenarios planned count = %d, want 2", len(planned))
	}

	// Update status to in_progress
	ipStatus := "in_progress"
	if err := st.UpdateScenario(scID, ScenarioUpdate{Status: &ipStatus}); err != nil {
		t.Fatalf("UpdateScenario in_progress: %v", err)
	}
	sc, err = st.GetScenario(scID)
	if err != nil {
		t.Fatalf("GetScenario after status update: %v", err)
	}
	if sc.Status != "in_progress" {
		t.Fatalf("scenario status after update = %q, want %q", sc.Status, "in_progress")
	}

	// Filter by in_progress
	inProgress, err := st.ListScenarios("in_progress")
	if err != nil {
		t.Fatalf("ListScenarios in_progress: %v", err)
	}
	if len(inProgress) != 1 {
		t.Fatalf("ListScenarios in_progress count = %d, want 1", len(inProgress))
	}

	// Update status to completed - should set completed_at
	cStatus := "completed"
	if err := st.UpdateScenario(scID, ScenarioUpdate{Status: &cStatus}); err != nil {
		t.Fatalf("UpdateScenario completed: %v", err)
	}
	sc, err = st.GetScenario(scID)
	if err != nil {
		t.Fatalf("GetScenario after completed: %v", err)
	}
	if sc.Status != "completed" {
		t.Fatalf("scenario status = %q, want %q", sc.Status, "completed")
	}
	if sc.CompletedAt == "" {
		t.Fatal("expected completed_at to be set after status=completed")
	}

	// Update name and description
	newName := "Build REST API"
	newDesc := "Updated description"
	if err := st.UpdateScenario(sc2ID, ScenarioUpdate{Name: &newName, Description: &newDesc}); err != nil {
		t.Fatalf("UpdateScenario name/desc: %v", err)
	}
	sc2, err := st.GetScenario(sc2ID)
	if err != nil {
		t.Fatalf("GetScenario sc2: %v", err)
	}
	if sc2.Name != "Build REST API" {
		t.Fatalf("sc2 name = %q, want %q", sc2.Name, "Build REST API")
	}
	if sc2.Description != "Updated description" {
		t.Fatalf("sc2 description = %q, want %q", sc2.Description, "Updated description")
	}

	// Delete scenario
	if err := st.DeleteScenario(scID); err != nil {
		t.Fatalf("DeleteScenario: %v", err)
	}
	all, err = st.ListScenarios("")
	if err != nil {
		t.Fatalf("ListScenarios after delete: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("ListScenarios after delete count = %d, want 1", len(all))
	}
}

// --- 5. TestDeckCardCRUD ---

func TestDeckCardCRUD(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create deck
	deckID, err := st.CreateDeck("AWS", "AWS services")
	if err != nil {
		t.Fatalf("CreateDeck: %v", err)
	}
	if deckID == 0 {
		t.Fatal("expected non-zero deck ID")
	}

	// List decks
	decks, err := st.ListDecks()
	if err != nil {
		t.Fatalf("ListDecks: %v", err)
	}
	if len(decks) != 1 {
		t.Fatalf("ListDecks count = %d, want 1", len(decks))
	}
	if decks[0].Name != "AWS" {
		t.Fatalf("deck name = %q, want %q", decks[0].Name, "AWS")
	}
	if decks[0].CardCount != 0 {
		t.Fatalf("deck card_count = %d, want 0", decks[0].CardCount)
	}

	// Get deck by name
	deck, err := st.GetDeckByName("AWS")
	if err != nil {
		t.Fatalf("GetDeckByName: %v", err)
	}
	if deck.ID != deckID {
		t.Fatalf("GetDeckByName ID = %d, want %d", deck.ID, deckID)
	}

	// Insert card without choices/tags
	cardID1, err := st.InsertCard(deckID, Card{
		Question: "What is S3?",
		Answer:   "Object storage",
	})
	if err != nil {
		t.Fatalf("InsertCard basic: %v", err)
	}

	// Insert card with choices, correct_index, extra, and tags
	idx := 1
	cardID2, err := st.InsertCard(deckID, Card{
		Question:     "Which is a compute service?",
		Answer:       "EC2",
		Extra:        "Elastic Compute Cloud",
		Choices:      []string{"S3", "EC2", "RDS", "SNS"},
		CorrectIndex: &idx,
		Tags:         []string{"compute", "ec2"},
	})
	if err != nil {
		t.Fatalf("InsertCard with choices: %v", err)
	}

	// List cards
	cards, err := st.ListCards(deckID, 0)
	if err != nil {
		t.Fatalf("ListCards: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("ListCards count = %d, want 2", len(cards))
	}

	// Verify card count in deck listing
	decks, err = st.ListDecks()
	if err != nil {
		t.Fatalf("ListDecks after cards: %v", err)
	}
	if decks[0].CardCount != 2 {
		t.Fatalf("deck card_count = %d, want 2", decks[0].CardCount)
	}

	// Get card
	card, err := st.GetCard(deckID, cardID2)
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	if card.Question != "Which is a compute service?" {
		t.Fatalf("card question = %q", card.Question)
	}
	if card.Extra != "Elastic Compute Cloud" {
		t.Fatalf("card extra = %q, want %q", card.Extra, "Elastic Compute Cloud")
	}
	if !reflect.DeepEqual(card.Choices, []string{"S3", "EC2", "RDS", "SNS"}) {
		t.Fatalf("card choices = %v", card.Choices)
	}
	if card.CorrectIndex == nil || *card.CorrectIndex != 1 {
		t.Fatalf("card correct_index = %v, want 1", card.CorrectIndex)
	}
	if !reflect.DeepEqual(card.Tags, []string{"compute", "ec2"}) {
		t.Fatalf("card tags = %v, want [compute ec2]", card.Tags)
	}

	// Update card
	newQ := "Updated question?"
	newTags := []string{"aws", "updated"}
	if err := st.UpdateCard(deckID, cardID1, CardUpdate{Question: &newQ, Tags: &newTags}); err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}
	card1, err := st.GetCard(deckID, cardID1)
	if err != nil {
		t.Fatalf("GetCard after update: %v", err)
	}
	if card1.Question != "Updated question?" {
		t.Fatalf("updated question = %q", card1.Question)
	}
	if !reflect.DeepEqual(card1.Tags, []string{"aws", "updated"}) {
		t.Fatalf("updated tags = %v", card1.Tags)
	}

	// Delete card
	if err := st.DeleteCard(deckID, cardID2); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	cards, err = st.ListCards(deckID, 0)
	if err != nil {
		t.Fatalf("ListCards after delete: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("ListCards after delete count = %d, want 1", len(cards))
	}

	// Delete deck
	if err := st.DeleteDeckByID(deckID); err != nil {
		t.Fatalf("DeleteDeckByID: %v", err)
	}
	decks, err = st.ListDecks()
	if err != nil {
		t.Fatalf("ListDecks after deck delete: %v", err)
	}
	if len(decks) != 0 {
		t.Fatalf("ListDecks after deck delete count = %d, want 0", len(decks))
	}
}

// --- 6. TestJunctionTables ---

func TestJunctionTables(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Setup: skill, deck, scenario
	skillID, err := st.CreateSkill("Go", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill: %v", err)
	}
	deckID, err := st.CreateDeck("Go Basics", "")
	if err != nil {
		t.Fatalf("CreateDeck: %v", err)
	}
	scID, err := st.CreateScenario("Go Project", "", "", nil)
	if err != nil {
		t.Fatalf("CreateScenario: %v", err)
	}

	// LinkDeckSkill
	if err := st.LinkDeckSkill(deckID, skillID); err != nil {
		t.Fatalf("LinkDeckSkill: %v", err)
	}

	// LinkScenarioSkill
	if err := st.LinkScenarioSkill(scID, skillID); err != nil {
		t.Fatalf("LinkScenarioSkill: %v", err)
	}

	// Verify GetSkill returns linked decks and scenarios
	sk, err := st.GetSkill(skillID)
	if err != nil {
		t.Fatalf("GetSkill: %v", err)
	}
	if len(sk.Decks) != 1 {
		t.Fatalf("GetSkill decks count = %d, want 1", len(sk.Decks))
	}
	if sk.Decks[0].ID != deckID {
		t.Fatalf("GetSkill deck ID = %d, want %d", sk.Decks[0].ID, deckID)
	}
	if len(sk.Scenarios) != 1 {
		t.Fatalf("GetSkill scenarios count = %d, want 1", len(sk.Scenarios))
	}
	if sk.Scenarios[0].ID != scID {
		t.Fatalf("GetSkill scenario ID = %d, want %d", sk.Scenarios[0].ID, scID)
	}

	// LinkDeckSkill again (idempotent via INSERT OR IGNORE)
	if err := st.LinkDeckSkill(deckID, skillID); err != nil {
		t.Fatalf("LinkDeckSkill duplicate: %v", err)
	}
	sk, err = st.GetSkill(skillID)
	if err != nil {
		t.Fatalf("GetSkill after dup link: %v", err)
	}
	if len(sk.Decks) != 1 {
		t.Fatalf("GetSkill decks after dup = %d, want 1", len(sk.Decks))
	}

	// UnlinkDeckSkill
	if err := st.UnlinkDeckSkill(deckID, skillID); err != nil {
		t.Fatalf("UnlinkDeckSkill: %v", err)
	}
	sk, err = st.GetSkill(skillID)
	if err != nil {
		t.Fatalf("GetSkill after unlink deck: %v", err)
	}
	if len(sk.Decks) != 0 {
		t.Fatalf("GetSkill decks after unlink = %d, want 0", len(sk.Decks))
	}

	// UnlinkScenarioSkill
	if err := st.UnlinkScenarioSkill(scID, skillID); err != nil {
		t.Fatalf("UnlinkScenarioSkill: %v", err)
	}
	sk, err = st.GetSkill(skillID)
	if err != nil {
		t.Fatalf("GetSkill after unlink scenario: %v", err)
	}
	if len(sk.Scenarios) != 0 {
		t.Fatalf("GetSkill scenarios after unlink = %d, want 0", len(sk.Scenarios))
	}
}

// --- 7. TestCardsForSkill ---

func TestCardsForSkill(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create skill hierarchy: Backend -> Go -> Concurrency
	backendID, err := st.CreateSkill("Backend", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill Backend: %v", err)
	}
	goID, err := st.CreateSkill("Go", "", &backendID, 1)
	if err != nil {
		t.Fatalf("CreateSkill Go: %v", err)
	}
	concID, err := st.CreateSkill("Concurrency", "", &goID, 2)
	if err != nil {
		t.Fatalf("CreateSkill Concurrency: %v", err)
	}

	// Create decks linked to child skills
	goDeckID, err := st.CreateDeck("Go Basics", "")
	if err != nil {
		t.Fatalf("CreateDeck Go Basics: %v", err)
	}
	concDeckID, err := st.CreateDeck("Concurrency", "")
	if err != nil {
		t.Fatalf("CreateDeck Concurrency: %v", err)
	}

	// Link decks to child skills
	if err := st.LinkDeckSkill(goDeckID, goID); err != nil {
		t.Fatalf("LinkDeckSkill Go: %v", err)
	}
	if err := st.LinkDeckSkill(concDeckID, concID); err != nil {
		t.Fatalf("LinkDeckSkill Concurrency: %v", err)
	}

	// Insert cards into decks
	if _, err := st.InsertCard(goDeckID, Card{Question: "What is Go?", Answer: "A language"}); err != nil {
		t.Fatalf("InsertCard Go: %v", err)
	}
	if _, err := st.InsertCard(goDeckID, Card{Question: "What is a goroutine?", Answer: "Lightweight thread"}); err != nil {
		t.Fatalf("InsertCard Go2: %v", err)
	}
	if _, err := st.InsertCard(concDeckID, Card{Question: "What is a channel?", Answer: "Communication pipe"}); err != nil {
		t.Fatalf("InsertCard Conc: %v", err)
	}

	// CardsForSkill on root (Backend) should find all 3 cards from descendant skills
	cards, err := st.CardsForSkill(backendID, 50)
	if err != nil {
		t.Fatalf("CardsForSkill Backend: %v", err)
	}
	if len(cards) != 3 {
		t.Fatalf("CardsForSkill Backend count = %d, want 3", len(cards))
	}

	// CardsForSkill on Go should find 3 (Go deck + Concurrency deck as descendant)
	cards, err = st.CardsForSkill(goID, 50)
	if err != nil {
		t.Fatalf("CardsForSkill Go: %v", err)
	}
	if len(cards) != 3 {
		t.Fatalf("CardsForSkill Go count = %d, want 3", len(cards))
	}

	// CardsForSkill on Concurrency should find 1 card (only its own deck)
	cards, err = st.CardsForSkill(concID, 50)
	if err != nil {
		t.Fatalf("CardsForSkill Concurrency: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("CardsForSkill Concurrency count = %d, want 1", len(cards))
	}

	// Skill with no linked decks returns empty
	unlinkedID, err := st.CreateSkill("Unlinked", "", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill Unlinked: %v", err)
	}
	cards, err = st.CardsForSkill(unlinkedID, 50)
	if err != nil {
		t.Fatalf("CardsForSkill Unlinked: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("CardsForSkill Unlinked count = %d, want 0", len(cards))
	}

	// Verify limit is respected
	cards, err = st.CardsForSkill(backendID, 2)
	if err != nil {
		t.Fatalf("CardsForSkill limit: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("CardsForSkill limit count = %d, want 2", len(cards))
	}
}

// --- 8. TestFullContext ---

func TestFullContext(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create skills
	goID, err := st.CreateSkill("Go", "Go programming", nil, 0)
	if err != nil {
		t.Fatalf("CreateSkill Go: %v", err)
	}
	concID, err := st.CreateSkill("Concurrency", "", &goID, 1)
	if err != nil {
		t.Fatalf("CreateSkill Concurrency: %v", err)
	}

	// Create a deck and link to Go
	deckID, err := st.CreateDeck("Go Basics", "Basic Go flashcards")
	if err != nil {
		t.Fatalf("CreateDeck: %v", err)
	}
	if _, err := st.InsertCard(deckID, Card{Question: "Q", Answer: "A"}); err != nil {
		t.Fatalf("InsertCard: %v", err)
	}
	if err := st.LinkDeckSkill(deckID, goID); err != nil {
		t.Fatalf("LinkDeckSkill: %v", err)
	}

	// Create scenarios
	scPlanned, err := st.CreateScenario("Build API", "REST API", "", []int64{goID})
	if err != nil {
		t.Fatalf("CreateScenario planned: %v", err)
	}
	scIP, err := st.CreateScenario("Build CLI", "", "", []int64{concID})
	if err != nil {
		t.Fatalf("CreateScenario in_progress: %v", err)
	}
	ipStatus := "in_progress"
	if err := st.UpdateScenario(scIP, ScenarioUpdate{Status: &ipStatus}); err != nil {
		t.Fatalf("UpdateScenario in_progress: %v", err)
	}

	// Create a completed scenario (should not appear in active)
	scCompleted, err := st.CreateScenario("Old Project", "", "", nil)
	if err != nil {
		t.Fatalf("CreateScenario completed: %v", err)
	}
	cStatus := "completed"
	if err := st.UpdateScenario(scCompleted, ScenarioUpdate{Status: &cStatus}); err != nil {
		t.Fatalf("UpdateScenario completed: %v", err)
	}

	// Get full context
	ctx, err := st.FullContext()
	if err != nil {
		t.Fatalf("FullContext: %v", err)
	}

	// Skill tree: 1 root (Go) with 1 child (Concurrency)
	if len(ctx.Skills) != 1 {
		t.Fatalf("FullContext skills count = %d, want 1", len(ctx.Skills))
	}
	if ctx.Skills[0].ID != goID {
		t.Fatalf("FullContext skills[0].ID = %d, want %d", ctx.Skills[0].ID, goID)
	}
	if len(ctx.Skills[0].Children) != 1 {
		t.Fatalf("FullContext Go children count = %d, want 1", len(ctx.Skills[0].Children))
	}

	// Go should have the deck attached
	if len(ctx.Skills[0].Decks) != 1 {
		t.Fatalf("FullContext Go decks count = %d, want 1", len(ctx.Skills[0].Decks))
	}
	if ctx.Skills[0].Decks[0].ID != deckID {
		t.Fatalf("FullContext Go deck ID = %d, want %d", ctx.Skills[0].Decks[0].ID, deckID)
	}
	if ctx.Skills[0].Decks[0].CardCount != 1 {
		t.Fatalf("FullContext deck card_count = %d, want 1", ctx.Skills[0].Decks[0].CardCount)
	}

	// Go should have scenario attached
	if len(ctx.Skills[0].Scenarios) != 1 {
		t.Fatalf("FullContext Go scenarios count = %d, want 1", len(ctx.Skills[0].Scenarios))
	}
	if ctx.Skills[0].Scenarios[0].ID != scPlanned {
		t.Fatalf("FullContext Go scenario ID = %d, want %d", ctx.Skills[0].Scenarios[0].ID, scPlanned)
	}

	// Concurrency child should have scenario attached
	if len(ctx.Skills[0].Children[0].Scenarios) != 1 {
		t.Fatalf("FullContext Concurrency scenarios count = %d, want 1", len(ctx.Skills[0].Children[0].Scenarios))
	}
	if ctx.Skills[0].Children[0].Scenarios[0].ID != scIP {
		t.Fatalf("FullContext Concurrency scenario ID = %d, want %d", ctx.Skills[0].Children[0].Scenarios[0].ID, scIP)
	}

	// Active scenarios: planned + in_progress only (not completed)
	if len(ctx.ActiveScenarios) != 2 {
		t.Fatalf("FullContext active scenarios count = %d, want 2", len(ctx.ActiveScenarios))
	}
	// Ordered by status DESC, name ASC => "planned" > "in_progress" alphabetically
	if ctx.ActiveScenarios[0].Status != "planned" {
		t.Fatalf("FullContext active[0].Status = %q, want %q", ctx.ActiveScenarios[0].Status, "planned")
	}
	if ctx.ActiveScenarios[1].Status != "in_progress" {
		t.Fatalf("FullContext active[1].Status = %q, want %q", ctx.ActiveScenarios[1].Status, "in_progress")
	}
}

// --- 9. TestChoicesEncoding ---

func TestChoicesEncoding(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		raw  sql.NullString
		want []string
	}{
		{name: "null", raw: sql.NullString{}, want: []string{}},
		{name: "empty string", raw: sql.NullString{String: "", Valid: true}, want: []string{}},
		{name: "legacy separator", raw: sql.NullString{String: "a|␟|b", Valid: true}, want: []string{"a", "b"}},
		{name: "json array", raw: sql.NullString{String: `["x","y","z"]`, Valid: true}, want: []string{"x", "y", "z"}},
		{name: "single value", raw: sql.NullString{String: "only", Valid: true}, want: []string{"only"}},
		{name: "json with spaces", raw: sql.NullString{String: ` ["a","b"] `, Valid: true}, want: []string{"a", "b"}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := decodeChoices(tc.raw)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("decodeChoices() = %#v, want %#v", got, tc.want)
			}
		})
	}

	// encodeChoices: nil/empty -> nil
	if got := encodeChoices(nil); got != nil {
		t.Fatalf("encodeChoices(nil) = %#v, want nil", got)
	}
	if got := encodeChoices([]string{}); got != nil {
		t.Fatalf("encodeChoices([]) = %#v, want nil", got)
	}

	// encodeChoices: non-empty -> separator-joined string
	if got, ok := encodeChoices([]string{"a", "b"}).(string); !ok || got != "a|␟|b" {
		t.Fatalf("encodeChoices non-empty = %#v, want %q", got, "a|␟|b")
	}
}

// --- 10. TestDeleteMissingRows ---

func TestDeleteMissingRows(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// DeleteSkill on missing
	if err := st.DeleteSkill(999); err == nil {
		t.Fatal("DeleteSkill on missing should fail")
	}

	// DeleteScenario on missing
	if err := st.DeleteScenario(999); err == nil {
		t.Fatal("DeleteScenario on missing should fail")
	}

	// DeleteDeckByID on missing
	if err := st.DeleteDeckByID(999); err == nil {
		t.Fatal("DeleteDeckByID on missing should fail")
	}

	// DeleteCard on missing (need a real deck first)
	deckID, err := st.CreateDeck("temp", "")
	if err != nil {
		t.Fatalf("CreateDeck: %v", err)
	}
	if err := st.DeleteCard(deckID, 999); err == nil {
		t.Fatal("DeleteCard on missing should fail")
	}
}

// --- 11. TestUpdateSkillMissing ---

func TestUpdateSkillMissing(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	name := "updated"
	if err := st.UpdateSkill(999, SkillUpdate{Name: &name}); err == nil {
		t.Fatal("UpdateSkill on missing should fail")
	}
}

// --- 12. TestValidateLevel ---

func TestValidateLevel(t *testing.T) {
	t.Parallel()

	for _, valid := range []int{0, 1, 2, 3, 4, 5} {
		if err := ValidateLevel(valid); err != nil {
			t.Fatalf("ValidateLevel(%d) should pass: %v", valid, err)
		}
	}
	for _, invalid := range []int{-1, 6, 100, -10} {
		if err := ValidateLevel(invalid); err == nil {
			t.Fatalf("ValidateLevel(%d) should fail", invalid)
		}
	}
}

// --- 13. TestClampLevel ---

func TestClampLevel(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in, want int
	}{
		{-5, 0}, {0, 0}, {3, 3}, {5, 5}, {6, 5}, {100, 5},
	}
	for _, tc := range cases {
		got := ClampLevel(tc.in)
		if got != tc.want {
			t.Fatalf("ClampLevel(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// --- 14. TestValidateStatus ---

func TestValidateStatus(t *testing.T) {
	t.Parallel()

	for _, valid := range []string{"planned", "in_progress", "completed", "abandoned"} {
		if err := ValidateStatus(valid); err != nil {
			t.Fatalf("ValidateStatus(%q) should pass: %v", valid, err)
		}
	}
	for _, invalid := range []string{"", "foo", "PLANNED", "done"} {
		if err := ValidateStatus(invalid); err == nil {
			t.Fatalf("ValidateStatus(%q) should fail", invalid)
		}
	}
}

// --- 15. TestImportFromQuiz ---

func TestImportFromQuiz(t *testing.T) {
	t.Parallel()

	st := openTempStore(t)

	// Create a quiz-style DB with decks, cards, and tags
	quizDB, quizPath := openTempQuizDB(t)

	// Insert decks into quiz DB
	res, err := quizDB.Exec(`INSERT INTO decks(name, description) VALUES(?, ?)`, "AWS", "Amazon Web Services")
	if err != nil {
		t.Fatalf("insert quiz deck AWS: %v", err)
	}
	awsDeckID, _ := res.LastInsertId()

	res, err = quizDB.Exec(`INSERT INTO decks(name, description) VALUES(?, ?)`, "Go", "Go programming")
	if err != nil {
		t.Fatalf("insert quiz deck Go: %v", err)
	}
	goDeckID, _ := res.LastInsertId()

	// Insert cards into AWS deck
	res, err = quizDB.Exec(
		`INSERT INTO cards(deck_id, question, answer, extra, choices, correct_index) VALUES(?, ?, ?, ?, ?, ?)`,
		awsDeckID, "What is S3?", "Object storage", "Simple Storage Service", "S3|␟|EC2|␟|RDS", 0,
	)
	if err != nil {
		t.Fatalf("insert quiz card 1: %v", err)
	}
	card1ID, _ := res.LastInsertId()

	_, err = quizDB.Exec(
		`INSERT INTO cards(deck_id, question, answer) VALUES(?, ?, ?)`,
		awsDeckID, "What is EC2?", "Compute service",
	)
	if err != nil {
		t.Fatalf("insert quiz card 2: %v", err)
	}

	// Insert cards into Go deck
	res, err = quizDB.Exec(
		`INSERT INTO cards(deck_id, question, answer) VALUES(?, ?, ?)`,
		goDeckID, "What is Go?", "A language",
	)
	if err != nil {
		t.Fatalf("insert quiz card 3: %v", err)
	}
	card3ID, _ := res.LastInsertId()

	// Insert tags
	if _, err := quizDB.Exec(`INSERT INTO card_tags(card_id, tag) VALUES(?, ?)`, card1ID, "storage"); err != nil {
		t.Fatalf("insert quiz tag 1: %v", err)
	}
	if _, err := quizDB.Exec(`INSERT INTO card_tags(card_id, tag) VALUES(?, ?)`, card3ID, "basics"); err != nil {
		t.Fatalf("insert quiz tag 2: %v", err)
	}
	if _, err := quizDB.Exec(`INSERT INTO card_tags(card_id, tag) VALUES(?, ?)`, card3ID, "intro"); err != nil {
		t.Fatalf("insert quiz tag 3: %v", err)
	}

	// Close quiz DB so ImportFromQuiz can open it
	quizDB.Close()

	// Run import
	decksImported, cardsImported, err := st.ImportFromQuiz(quizPath)
	if err != nil {
		t.Fatalf("ImportFromQuiz: %v", err)
	}
	if decksImported != 2 {
		t.Fatalf("decks imported = %d, want 2", decksImported)
	}
	if cardsImported != 3 {
		t.Fatalf("cards imported = %d, want 3", cardsImported)
	}

	// Verify decks exist
	decks, err := st.ListDecks()
	if err != nil {
		t.Fatalf("ListDecks after import: %v", err)
	}
	if len(decks) != 2 {
		t.Fatalf("ListDecks count = %d, want 2", len(decks))
	}

	// Verify AWS deck has correct card count
	awsDeck, err := st.GetDeckByName("AWS")
	if err != nil {
		t.Fatalf("GetDeckByName AWS: %v", err)
	}
	if awsDeck.CardCount != 2 {
		t.Fatalf("AWS deck card_count = %d, want 2", awsDeck.CardCount)
	}

	// Verify cards have choices imported
	awsCards, err := st.ListCards(awsDeck.ID, 50)
	if err != nil {
		t.Fatalf("ListCards AWS: %v", err)
	}
	if len(awsCards) != 2 {
		t.Fatalf("AWS cards count = %d, want 2", len(awsCards))
	}

	// Find the card with choices (S3 card)
	var s3Card *Card
	for i := range awsCards {
		if awsCards[i].Question == "What is S3?" {
			s3Card = &awsCards[i]
			break
		}
	}
	if s3Card == nil {
		t.Fatal("S3 card not found after import")
	}
	if !reflect.DeepEqual(s3Card.Choices, []string{"S3", "EC2", "RDS"}) {
		t.Fatalf("S3 card choices = %v, want [S3 EC2 RDS]", s3Card.Choices)
	}
	if s3Card.CorrectIndex == nil || *s3Card.CorrectIndex != 0 {
		t.Fatalf("S3 card correct_index = %v, want 0", s3Card.CorrectIndex)
	}
	if !reflect.DeepEqual(s3Card.Tags, []string{"storage"}) {
		t.Fatalf("S3 card tags = %v, want [storage]", s3Card.Tags)
	}
	if s3Card.Extra != "Simple Storage Service" {
		t.Fatalf("S3 card extra = %q, want %q", s3Card.Extra, "Simple Storage Service")
	}

	// Verify Go deck imported with tags
	goDeck, err := st.GetDeckByName("Go")
	if err != nil {
		t.Fatalf("GetDeckByName Go: %v", err)
	}
	goCards, err := st.ListCards(goDeck.ID, 50)
	if err != nil {
		t.Fatalf("ListCards Go: %v", err)
	}
	if len(goCards) != 1 {
		t.Fatalf("Go cards count = %d, want 1", len(goCards))
	}
	if !reflect.DeepEqual(goCards[0].Tags, []string{"basics", "intro"}) {
		t.Fatalf("Go card tags = %v, want [basics intro]", goCards[0].Tags)
	}

	// Run import again - should be idempotent (skips existing decks)
	decksImported2, cardsImported2, err := st.ImportFromQuiz(quizPath)
	if err != nil {
		t.Fatalf("ImportFromQuiz second run: %v", err)
	}
	if decksImported2 != 0 {
		t.Fatalf("second run decks imported = %d, want 0", decksImported2)
	}
	if cardsImported2 != 0 {
		t.Fatalf("second run cards imported = %d, want 0", cardsImported2)
	}

	// Verify no duplicates
	decks, err = st.ListDecks()
	if err != nil {
		t.Fatalf("ListDecks after second import: %v", err)
	}
	if len(decks) != 2 {
		t.Fatalf("ListDecks after second import count = %d, want 2", len(decks))
	}
}
