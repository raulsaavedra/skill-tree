package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/raulsaavedra/skill-tree/internal/httpapi"
	"github.com/raulsaavedra/skill-tree/internal/store"
)

func main() {
	var (
		addr        string
		originsRaw  string
		readTimeout time.Duration
	)

	flag.StringVar(&addr, "addr", envOrDefault("SKILL_TREE_API_ADDR", ":8080"), "listen address")
	flag.StringVar(&originsRaw, "allow-origins", envOrDefault("SKILL_TREE_API_ALLOW_ORIGINS", "http://localhost:3000"), "comma-separated CORS allowed origins")
	flag.DurationVar(&readTimeout, "read-header-timeout", 5*time.Second, "HTTP read header timeout")
	flag.Parse()

	st, dbPath, err := store.Open()
	if err != nil {
		fmt.Fprintf(os.Stderr, "open store: %v\n", err)
		os.Exit(1)
	}
	defer st.Close()

	origins := splitCSV(originsRaw)
	handler := httpapi.New(st, httpapi.Config{
		AllowedOrigins: origins,
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readTimeout,
	}

	fmt.Printf("skill-tree-api listening on %s (db: %s)\n", addr, dbPath)
	if len(origins) == 0 {
		fmt.Println("cors allow origins: (none)")
	} else {
		fmt.Printf("cors allow origins: %s\n", strings.Join(origins, ", "))
	}

	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	case sig := <-sigCh:
		fmt.Printf("received signal %s, shutting down\n", sig.String())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		fmt.Fprintf(os.Stderr, "shutdown error: %v\n", err)
		os.Exit(1)
	}
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		out = append(out, value)
	}
	return out
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
