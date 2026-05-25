package session

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"
)

// Session represents a client session.
type Session struct {
	ID        string   `json:"id"`
	CreatedAt int64    `json:"created_at"`
	Status    string   `json:"status"`
	Tasks     []string `json:"tasks"`
	ExpiresAt int64    `json:"expires_at"`
}

func nowMs() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}

// Manager manages client sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	expiry   time.Duration
}

// NewManager creates a new session manager with the given expiry duration.
func NewManager(expiry time.Duration) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		expiry:   expiry,
	}
}

// Create creates a new session with a unique ID.
func (m *Manager) Create() *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := generateID()
	now := nowMs()
	session := &Session{
		ID:        id,
		CreatedAt: now,
		Status:    "active",
		Tasks:     []string{},
		ExpiresAt: now + m.expiry.Milliseconds(),
	}
	m.sessions[id] = session
	return session
}

// Get retrieves a session by ID.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[id]
	if !ok {
		return nil, false
	}
	if nowMs() > session.ExpiresAt {
		return nil, false
	}
	return session, true
}

// List returns all active sessions.
func (m *Manager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := nowMs()
	var result []*Session
	for _, s := range m.sessions {
		if now <= s.ExpiresAt {
			result = append(result, s)
		}
	}
	return result
}

// AddTask adds a task ID to a session.
func (m *Manager) AddTask(sessionID, taskID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if session, ok := m.sessions[sessionID]; ok {
		session.Tasks = append(session.Tasks, taskID)
	}
}

// Cleanup removes expired sessions.
func (m *Manager) Cleanup() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := nowMs()
	for id, s := range m.sessions {
		if now > s.ExpiresAt {
			delete(m.sessions, id)
		}
	}
}

// generateID creates a random UUID-like string.
func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
