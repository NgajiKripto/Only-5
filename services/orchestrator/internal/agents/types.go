package agents

// AgentConfig defines the configuration for an agent.
type AgentConfig struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Capabilities []string `json:"capabilities"`
	Priority     int      `json:"priority"`
}

// AgentTask represents a task to be dispatched to an agent.
type AgentTask struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Target    string                 `json:"target"`
	Params    map[string]interface{} `json:"params"`
	CreatedAt int64                  `json:"created_at"`
}

// AgentResult represents the result of an agent executing a task.
type AgentResult struct {
	AgentName string      `json:"agent_name"`
	TaskID    string      `json:"task_id"`
	Success   bool        `json:"success"`
	Data      interface{} `json:"data"`
	Error     string      `json:"error,omitempty"`
	Duration  int64       `json:"duration_ms"`
	Findings  []string    `json:"findings"`
}

// AgentStatus represents the current status of an agent.
type AgentStatus struct {
	Name           string `json:"name"`
	Status         string `json:"status"`
	TasksCompleted int    `json:"tasks_completed"`
	TasksFailed    int    `json:"tasks_failed"`
}

// Agent is the interface that all agents must implement.
type Agent interface {
	Config() AgentConfig
	Execute(task AgentTask) AgentResult
}
