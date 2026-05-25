package agents

import "sync"

// Registry manages registered agents and provides lookup by capability.
type Registry struct {
	mu     sync.RWMutex
	agents map[string]Agent
	status map[string]*AgentStatus
}

// NewRegistry creates a new agent registry.
func NewRegistry() *Registry {
	return &Registry{
		agents: make(map[string]Agent),
		status: make(map[string]*AgentStatus),
	}
}

// Register adds an agent to the registry.
func (r *Registry) Register(agent Agent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name := agent.Config().Name
	r.agents[name] = agent
	r.status[name] = &AgentStatus{
		Name:   name,
		Status: "idle",
	}
}

// FindByCapability returns all agents whose capabilities include the given task type.
func (r *Registry) FindByCapability(taskType string) []Agent {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Agent
	for _, agent := range r.agents {
		for _, cap := range agent.Config().Capabilities {
			if cap == taskType {
				result = append(result, agent)
				break
			}
		}
	}
	return result
}

// FindBest returns the highest priority agent for the given task type.
func (r *Registry) FindBest(taskType string) Agent {
	agents := r.FindByCapability(taskType)
	if len(agents) == 0 {
		return nil
	}
	best := agents[0]
	for _, agent := range agents[1:] {
		if agent.Config().Priority > best.Config().Priority {
			best = agent
		}
	}
	return best
}

// List returns the status of all registered agents.
func (r *Registry) List() []AgentStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AgentStatus
	for _, s := range r.status {
		result = append(result, *s)
	}
	return result
}

// Get retrieves a specific agent by name.
func (r *Registry) Get(name string) (Agent, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	agent, ok := r.agents[name]
	return agent, ok
}

// SetStatus updates the status of a named agent.
func (r *Registry) SetStatus(name, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.status[name]; ok {
		s.Status = status
	}
}

// IncrementCompleted increments the tasks_completed counter for the named agent.
func (r *Registry) IncrementCompleted(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.status[name]; ok {
		s.TasksCompleted++
	}
}

// IncrementFailed increments the tasks_failed counter for the named agent.
func (r *Registry) IncrementFailed(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.status[name]; ok {
		s.TasksFailed++
	}
}
