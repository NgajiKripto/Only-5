package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/agents"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/handlers"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/session"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/streaming"
)

func main() {
	// Initialize agent registry
	registry := agents.NewRegistry()
	registry.Register(&agents.SecurityAgent{})
	registry.Register(&agents.DeFiAgent{})
	registry.Register(&agents.MarketAgent{})
	registry.Register(&agents.BountyAgent{})

	// Create runner with 30s timeout
	runner := agents.NewRunner(registry, 30*time.Second)

	// Create streaming manager with buffer of 100 events
	streamMgr := streaming.NewManager(100)

	// Create session manager with 1 hour expiry
	sessionMgr := session.NewManager(1 * time.Hour)

	// Create HTTP server
	server := handlers.NewServer(runner, streamMgr, sessionMgr)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)

	port := os.Getenv("ORCHESTRATOR_PORT")
	if port == "" {
		port = "7002"
	}

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // Disabled for SSE
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Start background session cleanup every 5 minutes
	cleanupDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				sessionMgr.Cleanup()
			case <-cleanupDone:
				return
			}
		}
	}()

	go func() {
		fmt.Printf("Orchestrator service starting on :%s\n", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-stop
	fmt.Println("\nShutting down gracefully...")

	close(cleanupDone)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
	fmt.Println("Server stopped")
}
