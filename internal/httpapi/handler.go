package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/raulsaavedra/skill-tree/internal/store"
)

// Config controls HTTP handler behavior.
type Config struct {
	AllowedOrigins []string
}

type handler struct {
	st             *store.Store
	allowedOrigins map[string]bool
	allowAnyOrigin bool
}

// New returns the API handler with all routes mounted.
func New(st *store.Store, cfg Config) http.Handler {
	h := &handler{
		st:             st,
		allowedOrigins: map[string]bool{},
	}
	for _, origin := range cfg.AllowedOrigins {
		o := strings.TrimSpace(origin)
		if o == "" {
			continue
		}
		if o == "*" {
			h.allowAnyOrigin = true
			continue
		}
		h.allowedOrigins[o] = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", h.handleHealth)
	mux.HandleFunc("/v1/context", h.handleContext)
	mux.HandleFunc("/v1/skills/tree", h.handleSkillTree)
	mux.HandleFunc("/v1/decks", h.handleDecks)
	mux.HandleFunc("/v1/decks/", h.handleDeckByPath)
	mux.HandleFunc("/v1/scenarios", h.handleScenarios)
	mux.HandleFunc("/v1/cards/covered", h.handleCardsCovered)
	mux.HandleFunc("/v1/cards/", h.handleCardByPath)

	return h.withMiddlewares(mux)
}

func (h *handler) withMiddlewares(next http.Handler) http.Handler {
	withCORS := h.cors(next)
	return h.requestLogger(withCORS)
}

func (h *handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *handler) handleContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, err := h.st.FullContext()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load context: %v", err))
		return
	}
	h.writeJSON(w, http.StatusOK, ctx)
}

func (h *handler) handleSkillTree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	tree, err := h.st.SkillTree()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load skill tree: %v", err))
		return
	}
	h.writeJSON(w, http.StatusOK, tree)
}

func (h *handler) handleDecks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	decks, err := h.st.ListDecks()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load decks: %v", err))
		return
	}
	h.writeJSON(w, http.StatusOK, decks)
}

func (h *handler) handleScenarios(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	scenarios, err := h.st.ListScenarios(status)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load scenarios: %v", err))
		return
	}
	h.writeJSON(w, http.StatusOK, scenarios)
}

func (h *handler) handleDeckByPath(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/decks/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "cards" {
		h.writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	deckID, err := parseInt64(parts[0], "deck id")
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	limit := 200
	limitRaw := strings.TrimSpace(r.URL.Query().Get("limit"))
	if limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 {
			h.writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = value
	}

	cards, err := h.st.ListCards(deckID, limit)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load deck cards: %v", err))
		return
	}
	h.writeJSON(w, http.StatusOK, cards)
}

func (h *handler) handleCardsCovered(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	idsRaw := strings.TrimSpace(r.URL.Query().Get("ids"))
	ids, err := parseCSVInt64(idsRaw)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	coveredSet, err := h.st.CoveredCardIDs(ids)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("load covered cards: %v", err))
		return
	}

	coveredIDs := make([]int64, 0, len(coveredSet))
	for _, id := range ids {
		if coveredSet[id] {
			coveredIDs = append(coveredIDs, id)
		}
	}
	h.writeJSON(w, http.StatusOK, map[string]any{
		"covered_ids": coveredIDs,
	})
}

func (h *handler) handleCardByPath(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/cards/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "cover" {
		h.writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	cardID, err := parseInt64(parts[0], "card id")
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.st.MarkCardCovered(cardID); err != nil {
		h.writeError(w, http.StatusInternalServerError, fmt.Sprintf("mark card covered: %v", err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (h *handler) writeError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"message": message,
			"status":  status,
		},
	})
}

func (h *handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if h.allowAnyOrigin {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if h.allowedOrigins[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			if w.Header().Get("Access-Control-Allow-Origin") != "" {
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *handler) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s %s (%s)\n", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start).Round(time.Millisecond))
	})
}

func parseCSVInt64(raw string) ([]int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return []int64{}, nil
	}
	parts := strings.Split(value, ",")
	out := make([]int64, 0, len(parts))
	for _, part := range parts {
		parsed, err := parseInt64(part, "id")
		if err != nil {
			return nil, err
		}
		out = append(out, parsed)
	}
	return out, nil
}

func parseInt64(raw, label string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, fmt.Errorf("%s is required", label)
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("invalid %s", label)
	}
	return parsed, nil
}
