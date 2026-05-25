package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/agents"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/session"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/streaming"
)

// Server holds the HTTP handler dependencies.
type Server struct {
	runner    *agents.Runner
	streaming *streaming.Manager
	sessions  *session.Manager
}

// NewServer creates a new handler server.
func NewServer(runner *agents.Runner, stream *streaming.Manager, sessions *session.Manager) *Server {
	return &Server{
		runner:    runner,
		streaming: stream,
		sessions:  sessions,
	}
}

// RegisterRoutes registers all HTTP routes on the given mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/health", s.corsMiddleware(s.handleHealth))
	mux.HandleFunc("/agents", s.corsMiddleware(s.handleAgents))
	mux.HandleFunc("/dispatch", s.corsMiddleware(s.handleDispatch))
	mux.HandleFunc("/dispatch/parallel", s.corsMiddleware(s.handleDispatchParallel))
	mux.HandleFunc("/stream", s.corsMiddleware(s.handleStream))
	mux.HandleFunc("/sessions", s.corsMiddleware(s.handleSessions))
	mux.HandleFunc("/sessions/", s.corsMiddleware(s.handleSessionByID))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "healthy",
		"service":   "orchestrator",
		"timestamp": time.Now().Unix(),
	})
}

func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"agents": s.runner.Registry().List(),
	})
}

func (s *Server) handleDispatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var task agents.AgentTask
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if task.ID == "" {
		task.ID = fmt.Sprintf("task-%d", time.Now().UnixNano())
	}
	if task.CreatedAt == 0 {
		task.CreatedAt = time.Now().Unix()
	}

	s.streaming.Broadcast(streaming.Event{
		ID:        fmt.Sprintf("evt-%d", time.Now().UnixNano()),
		Type:      streaming.EventTaskDispatched,
		Timestamp: time.Now().Unix(),
		Data:      task,
	})

	result := s.runner.Run(task)

	if result.Success {
		s.streaming.Broadcast(streaming.Event{
			ID:        fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			Type:      streaming.EventAgentCompleted,
			Timestamp: time.Now().Unix(),
			Data:      result,
		})
	} else {
		s.streaming.Broadcast(streaming.Event{
			ID:        fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			Type:      streaming.EventAgentFailed,
			Timestamp: time.Now().Unix(),
			Data:      result,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDispatchParallel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Tasks []agents.AgentTask `json:"tasks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	for i := range req.Tasks {
		if req.Tasks[i].ID == "" {
			req.Tasks[i].ID = fmt.Sprintf("task-%d-%d", time.Now().UnixNano(), i)
		}
		if req.Tasks[i].CreatedAt == 0 {
			req.Tasks[i].CreatedAt = time.Now().Unix()
		}
	}

	results := s.runner.RunParallel(req.Tasks)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"results": results,
	})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		sessionID = fmt.Sprintf("stream-%d", time.Now().UnixNano())
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.streaming.Subscribe(sessionID)
	defer s.streaming.Unsubscribe(sessionID)

	ctx := r.Context()
	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-ctx.Done():
			return
		}
	}
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		sess := s.sessions.Create()
		s.streaming.Broadcast(streaming.Event{
			ID:        fmt.Sprintf("evt-%d", time.Now().UnixNano()),
			Type:      streaming.EventSessionCreated,
			Timestamp: time.Now().Unix(),
			SessionID: sess.ID,
			Data:      sess,
		})
		writeJSON(w, http.StatusCreated, sess)
	case http.MethodGet:
		sessions := s.sessions.List()
		if sessions == nil {
			sessions = []*session.Session{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"sessions": sessions,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSessionByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse session ID from path: /sessions/{id}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/sessions/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "session id required", http.StatusBadRequest)
		return
	}
	id := parts[0]

	sess, ok := s.sessions.Get(id)
	if !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (s *Server) corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
