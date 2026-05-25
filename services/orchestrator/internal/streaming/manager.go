package streaming

import "sync"

// Manager manages SSE event streaming to subscribers.
type Manager struct {
	mu          sync.RWMutex
	subscribers map[string]chan Event
	buffer      []Event
	bufferSize  int
}

// NewManager creates a new streaming manager with the given buffer size.
func NewManager(bufferSize int) *Manager {
	return &Manager{
		subscribers: make(map[string]chan Event),
		buffer:      make([]Event, 0, bufferSize),
		bufferSize:  bufferSize,
	}
}

// Subscribe registers a subscriber and returns a channel for receiving events.
func (m *Manager) Subscribe(sessionID string) <-chan Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch := make(chan Event, 64)
	m.subscribers[sessionID] = ch
	return ch
}

// Unsubscribe removes a subscriber and closes its channel.
func (m *Manager) Unsubscribe(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ch, ok := m.subscribers[sessionID]; ok {
		close(ch)
		delete(m.subscribers, sessionID)
	}
}

// Broadcast sends an event to all subscribers (non-blocking).
func (m *Manager) Broadcast(event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Add to buffer
	if len(m.buffer) >= m.bufferSize {
		m.buffer = m.buffer[1:]
	}
	m.buffer = append(m.buffer, event)

	// Send to all subscribers non-blocking
	for _, ch := range m.subscribers {
		select {
		case ch <- event:
		default:
			// Skip if subscriber channel is full
		}
	}
}

// GetBuffer returns a copy of the recent events buffer.
func (m *Manager) GetBuffer() []Event {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]Event, len(m.buffer))
	copy(result, m.buffer)
	return result
}

// SubscriberCount returns the number of active subscribers.
func (m *Manager) SubscriberCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.subscribers)
}
