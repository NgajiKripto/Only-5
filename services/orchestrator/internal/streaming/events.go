package streaming

// EventType represents the type of a streaming event.
type EventType string

const (
	EventAgentStarted   EventType = "agent_started"
	EventAgentCompleted EventType = "agent_completed"
	EventAgentFailed    EventType = "agent_failed"
	EventTaskDispatched EventType = "task_dispatched"
	EventSessionCreated EventType = "session_created"
)

// Event represents a streaming event sent to subscribers.
type Event struct {
	ID        string      `json:"id"`
	Type      EventType   `json:"type"`
	Timestamp int64       `json:"timestamp"`
	SessionID string      `json:"session_id"`
	Data      interface{} `json:"data"`
}
