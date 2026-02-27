package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/raulsaavedra/skill-tree/internal/store"
)

type reviewStage int

const (
	stageDeckSelect reviewStage = iota
	stageReview
	stageDone
)

// ReviewMode controls how cards are presented.
type ReviewMode string

const (
	ModeFlashcard ReviewMode = "flashcard"
	ModeMCQ       ReviewMode = "mcq"
	ModeAuto      ReviewMode = "auto"
)

// ParseMode converts a raw string into a valid ReviewMode.
func ParseMode(raw string) (ReviewMode, error) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", "auto":
		return ModeAuto, nil
	case "flashcard":
		return ModeFlashcard, nil
	case "mcq":
		return ModeMCQ, nil
	default:
		return "", fmt.Errorf("invalid mode %q (expected: flashcard, mcq, auto)", raw)
	}
}

// ReviewModel handles flashcard/MCQ review sessions.
type ReviewModel struct {
	decks        []store.Deck
	cardsByDeck  map[int64][]store.Card
	deckCursor   int
	cards        []store.Card
	cardCursor   int
	choiceCursor int
	showAnswer   bool
	mode         ReviewMode
	stage        reviewStage
	err          error
	width        int
	done         bool
	fromTree     bool
	st *store.Store // nil-safe: coverage writes skipped if nil
}

// NewReviewModel creates a ReviewModel. If startInReview is true, the selected
// deck is activated immediately without showing the deck selection screen.
func NewReviewModel(
	decks []store.Deck,
	cardsByDeck map[int64][]store.Card,
	selectedDeck int,
	mode ReviewMode,
	startInReview bool,
	st *store.Store,
) ReviewModel {
	if len(decks) == 0 {
		return ReviewModel{
			decks:       decks,
			cardsByDeck: cardsByDeck,
			mode:        mode,
			stage:       stageDeckSelect,
		}
	}

	if selectedDeck < 0 {
		selectedDeck = 0
	}
	if selectedDeck >= len(decks) {
		selectedDeck = len(decks) - 1
	}

	m := ReviewModel{
		decks:       decks,
		cardsByDeck: cardsByDeck,
		deckCursor:  selectedDeck,
		mode:        mode,
		stage:       stageDeckSelect,
		st:          st,
	}
	if startInReview {
		m.fromTree = true
		m.activateDeck(selectedDeck)
		if len(m.cards) == 0 {
			m.stage = stageDone
		} else {
			m.stage = stageReview
		}
	}
	return m
}

// Done returns true when the user wants to leave the review and go back.
func (m ReviewModel) Done() bool { return m.done }

// Init satisfies the tea.Model interface.
func (m ReviewModel) Init() tea.Cmd { return nil }

// Update handles key events and window size changes.
func (m ReviewModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		}

		switch m.stage {
		case stageDeckSelect:
			return m.updateDeckSelect(msg), nil
		case stageDone:
			return m.updateDone(msg), nil
		default:
			return m.updateReview(msg), nil
		}
	}
	return m, nil
}

// View renders the current review state.
func (m ReviewModel) View() string {
	if m.err != nil {
		return "Error: " + m.err.Error()
	}

	switch m.stage {
	case stageDeckSelect:
		return m.renderDeckSelect()
	case stageDone:
		return m.renderDone()
	default:
		return m.renderReview()
	}
}

func (m ReviewModel) updateDeckSelect(msg tea.KeyMsg) ReviewModel {
	switch msg.String() {
	case "q", "esc", "b":
		m.done = true
		return m
	case "up", "k":
		if m.deckCursor > 0 {
			m.deckCursor--
		}
	case "down", "j":
		if m.deckCursor < len(m.decks)-1 {
			m.deckCursor++
		}
	case "enter", " ":
		m.activateDeck(m.deckCursor)
		if len(m.cards) == 0 {
			m.stage = stageDone
		} else {
			m.stage = stageReview
		}
	}
	return m
}

func (m ReviewModel) updateDone(msg tea.KeyMsg) ReviewModel {
	switch msg.String() {
	case "q", "esc":
		m.done = true
	case "b":
		if m.fromTree {
			m.done = true
		} else if len(m.decks) > 0 {
			m.refreshDeckCoverage()
			m.stage = stageDeckSelect
		} else {
			m.done = true
		}
	case "enter", " ":
		if m.fromTree {
			m.done = true
		} else if len(m.decks) > 0 {
			m.refreshDeckCoverage()
			m.stage = stageDeckSelect
		}
	}
	return m
}

func (m ReviewModel) updateReview(msg tea.KeyMsg) ReviewModel {
	if len(m.cards) == 0 {
		switch msg.String() {
		case "b":
			if m.fromTree {
				m.done = true
			} else if len(m.decks) > 0 {
				m.refreshDeckCoverage()
				m.stage = stageDeckSelect
			}
		case "q", "esc":
			m.done = true
		}
		return m
	}

	switch msg.String() {
	case "q", "esc":
		m.done = true
		return m
	case "b":
		if m.fromTree {
			m.done = true
			return m
		}
		if len(m.decks) > 0 {
			m.refreshDeckCoverage()
			m.stage = stageDeckSelect
			return m
		}
	case "left", "h", "p":
		m.prevCard()
	case "right", "l", "n":
		m.nextCard()
	case "N":
		m.jumpBy(10)
	case "P":
		m.jumpBy(-10)
	case "up", "k":
		card := m.currentCard()
		if m.currentEffectiveMode() == ModeMCQ && card != nil && len(card.Choices) > 0 {
			m.choiceCursor = (m.choiceCursor - 1 + len(card.Choices)) % len(card.Choices)
		}
	case "down", "j":
		card := m.currentCard()
		if m.currentEffectiveMode() == ModeMCQ && card != nil && len(card.Choices) > 0 {
			m.choiceCursor = (m.choiceCursor + 1) % len(card.Choices)
		}
	case "f":
		m.mode = ModeFlashcard
	case "m":
		m.mode = ModeMCQ
	case "a":
		m.mode = ModeAuto
	case "enter", " ":
		if m.showAnswer {
			// Mark card covered: flashcard always, MCQ already scored on reveal.
			card := m.currentCard()
			if card != nil && m.st != nil {
				_ = m.st.MarkCardCovered(card.ID)
			}
			if m.cardCursor >= len(m.cards)-1 {
				m.stage = stageDone
				return m
			}
			m.nextCard()
			return m
		}
		// Reveal answer.
		m.showAnswer = true
		// MCQ auto-score on reveal.
		if m.currentEffectiveMode() == ModeMCQ {
			card := m.currentCard()
			if card != nil && card.CorrectIndex != nil && m.choiceCursor == *card.CorrectIndex {
				if m.st != nil {
					_ = m.st.MarkCardCovered(card.ID)
				}
			}
		}
	}

	return m
}

func (m *ReviewModel) activateDeck(index int) {
	if index < 0 || index >= len(m.decks) {
		m.cards = nil
		return
	}
	deck := m.decks[index]
	m.cards = append([]store.Card(nil), m.cardsByDeck[deck.ID]...)
	m.cardCursor = 0
	m.choiceCursor = 0
	m.showAnswer = false
}

// refreshDeckCoverage re-reads CoveredCount from the DB for all decks.
func (m *ReviewModel) refreshDeckCoverage() {
	if m.st == nil {
		return
	}
	for i := range m.decks {
		covered, _, err := m.st.DeckCoverage(m.decks[i].ID)
		if err == nil {
			m.decks[i].CoveredCount = covered
		}
	}
}

func (m *ReviewModel) resetRevealState() {
	m.showAnswer = false
	m.choiceCursor = 0
}

func (m *ReviewModel) nextCard() {
	if len(m.cards) == 0 {
		m.stage = stageDone
		return
	}
	if m.cardCursor >= len(m.cards)-1 {
		return
	}
	m.cardCursor++
	m.resetRevealState()
}

func (m *ReviewModel) prevCard() {
	if m.cardCursor <= 0 {
		return
	}
	m.cardCursor--
	m.resetRevealState()
}

func (m *ReviewModel) jumpBy(delta int) {
	if len(m.cards) == 0 {
		return
	}
	next := m.cardCursor + delta
	if next < 0 {
		next = 0
	}
	if next >= len(m.cards) {
		next = len(m.cards) - 1
	}
	if next != m.cardCursor {
		m.cardCursor = next
		m.resetRevealState()
	}
}

func (m ReviewModel) currentCard() *store.Card {
	if m.cardCursor < 0 || m.cardCursor >= len(m.cards) {
		return nil
	}
	return &m.cards[m.cardCursor]
}

func (m ReviewModel) hasChoices(card *store.Card) bool {
	return card != nil && len(card.Choices) > 0 && card.CorrectIndex != nil
}

func (m ReviewModel) currentEffectiveMode() ReviewMode {
	card := m.currentCard()
	if m.mode == ModeFlashcard {
		return ModeFlashcard
	}
	if m.mode == ModeMCQ {
		if m.hasChoices(card) {
			return ModeMCQ
		}
		return ModeFlashcard
	}
	if m.hasChoices(card) {
		return ModeMCQ
	}
	return ModeFlashcard
}

func (m ReviewModel) modeLabel() string {
	switch m.mode {
	case ModeFlashcard:
		return "Flashcard"
	case ModeMCQ:
		return "MCQ"
	default:
		return "Auto"
	}
}

func (m ReviewModel) renderDeckSelect() string {
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14")).Render("Select a deck")
	help := lipgloss.NewStyle().Faint(true).Render("j/k Navigate  enter Select  b Back  q Quit")

	lines := []string{title, help, ""}
	if len(m.decks) == 0 {
		lines = append(lines, "No decks found.")
		lines = append(lines, "Ask an agent to create a deck for you.")
		return renderWithHorizontalPadding(lines, m.width)
	}

	for i, d := range m.decks {
		prefix := "  "
		style := lipgloss.NewStyle()
		if i == m.deckCursor {
			prefix = "> "
			style = style.Foreground(lipgloss.Color("13")).Bold(true)
		}
		cov := renderCoverage(d.CoveredCount, d.CardCount)
		lines = append(lines, style.Render(fmt.Sprintf("%s%s (%d)", prefix, d.Name, d.CardCount))+" "+cov)
	}
	return renderWithHorizontalPadding(lines, m.width)
}

func (m ReviewModel) renderDone() string {
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10")).Render("review")
	lines := []string{title, ""}
	if len(m.cards) == 0 {
		lines = append(lines, "No cards found for selected deck.")
	} else {
		lines = append(lines, "Finished review.")
	}
	if len(m.decks) > 0 {
		lines = append(lines, "", lipgloss.NewStyle().Faint(true).Render("enter/b: back to decks | q: quit"))
	} else {
		lines = append(lines, "", lipgloss.NewStyle().Faint(true).Render("q: quit"))
	}
	return renderWithHorizontalPadding(lines, m.width)
}

func (m ReviewModel) renderReview() string {
	if len(m.cards) == 0 {
		return renderWithHorizontalPadding([]string{"No cards to review."}, m.width)
	}

	card := m.cards[m.cardCursor]
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14")).Render("review")
	deckName := "Review"
	if m.deckCursor >= 0 && m.deckCursor < len(m.decks) {
		deckName = m.decks[m.deckCursor].Name
	}
	progress := fmt.Sprintf("[%d/%d] [%s] %s", m.cardCursor+1, len(m.cards), m.modeLabel(), deckName)

	lines := []string{
		title,
		m.renderPagination(),
		progress,
		"",
		m.renderQuestion(card.Question),
	}

	if m.currentEffectiveMode() == ModeMCQ && m.hasChoices(&card) {
		lines = append(lines, "")
		lines = append(lines, m.renderMCQ(card)...)
	}

	if m.showAnswer {
		lines = append(lines, "")
		lines = append(lines, m.renderAnswer(card)...)
	}

	var help string
	if m.currentEffectiveMode() == ModeMCQ {
		help = "enter/space: reveal->next | j/k: choice | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit"
	} else {
		help = "enter/space: reveal->next | n/p: next/prev | N/P: jump 10 | f/m/a: mode | q: quit"
	}
	if len(m.decks) > 1 {
		help += " | b: decks"
	}
	lines = append(lines, "", lipgloss.NewStyle().Faint(true).Render(help))
	return renderWithHorizontalPadding(lines, m.width)
}

func (m ReviewModel) renderMCQ(card store.Card) []string {
	out := make([]string, 0, len(card.Choices))
	for i, choice := range card.Choices {
		selected := i == m.choiceCursor
		prefix := "  "
		if selected {
			prefix = "> "
		}

		style := lipgloss.NewStyle()
		if m.showAnswer && card.CorrectIndex != nil && *card.CorrectIndex == i {
			style = style.Foreground(lipgloss.Color("10")).Bold(true)
		} else if m.showAnswer && selected {
			style = style.Foreground(lipgloss.Color("9")).Bold(true)
		} else if selected {
			style = style.Foreground(lipgloss.Color("13")).Bold(true)
		}

		out = append(out, style.Render(fmt.Sprintf("%s%s", prefix, choice)))
	}
	return out
}

func (m ReviewModel) renderPagination() string {
	total := len(m.cards)
	if total == 0 {
		return ""
	}

	const maxDots = 40
	if total <= maxDots {
		dots := make([]string, 0, total)
		for i := range m.cards {
			style := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
			if i == m.cardCursor {
				style = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Bold(true)
			}
			dots = append(dots, style.Render("•"))
		}
		return strings.Join(dots, "")
	}

	// Sliding window: show maxDots dots centered on cursor with ellipsis
	half := maxDots / 2
	start := m.cardCursor - half
	end := start + maxDots
	if start < 0 {
		start = 0
		end = maxDots
	}
	if end > total {
		end = total
		start = total - maxDots
		if start < 0 {
			start = 0
		}
	}

	dim := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	var parts []string
	if start > 0 {
		parts = append(parts, dim.Render("…"))
	}
	for i := start; i < end; i++ {
		style := dim
		if i == m.cardCursor {
			style = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Bold(true)
		}
		parts = append(parts, style.Render("•"))
	}
	if end < total {
		parts = append(parts, dim.Render("…"))
	}
	return strings.Join(parts, "")
}

func (m ReviewModel) renderAnswer(card store.Card) []string {
	answer := answerText(card)
	answerHeader := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10")).Render("Answer")
	lines := []string{answerHeader}
	lines = append(lines, m.wrapLines(renderMarkdown(answer, lipgloss.NewStyle().Foreground(lipgloss.Color("10"))))...)
	if strings.TrimSpace(card.Extra) != "" {
		lines = append(lines, "")
		lines = append(lines, m.wrapLines(renderMarkdown(card.Extra, lipgloss.NewStyle()))...)
	}
	return lines
}

func (m ReviewModel) wrapLines(lines []string) []string {
	if m.width <= 0 {
		return lines
	}
	pad := horizontalPadding(m.width)
	w := m.width - 2*pad
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, lipgloss.NewStyle().Width(w).Render(line))
	}
	return out
}

func (m ReviewModel) renderQuestion(question string) string {
	style := lipgloss.NewStyle().Bold(true)
	if m.width > 0 {
		pad := horizontalPadding(m.width)
		style = style.Width(m.width - 2*pad)
	}
	return style.Render(question)
}

func renderCoverage(covered, total int) string {
	if total == 0 {
		return lipgloss.NewStyle().Faint(true).Render("--")
	}
	pct := covered * 100 / total
	color := "8" // dim for 0%
	if pct >= 100 {
		color = "10" // green
	} else if pct >= 50 {
		color = "14" // cyan
	} else if pct > 0 {
		color = "11" // yellow
	}
	return lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Render(fmt.Sprintf("%d%%", pct))
}

func answerText(card store.Card) string {
	if card.CorrectIndex == nil {
		return card.Answer
	}
	idx := *card.CorrectIndex
	if idx >= 0 && idx < len(card.Choices) {
		return card.Choices[idx]
	}
	return card.Answer
}
