package agents

import (
	"context"
	"sync"
	"time"
)

// Runner executes tasks against registered agents.
type Runner struct {
	registry *Registry
	timeout  time.Duration
	mu       sync.Mutex
	running  map[string]bool
}

// NewRunner creates a new Runner with the given registry and timeout.
func NewRunner(registry *Registry, timeout time.Duration) *Runner {
	return &Runner{
		registry: registry,
		timeout:  timeout,
		running:  make(map[string]bool),
	}
}

// Run dispatches a single task to the best matching agent.
func (r *Runner) Run(task AgentTask) AgentResult {
	agent := r.registry.FindBest(task.Type)
	if agent == nil {
		return AgentResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    "no agent found for task type: " + task.Type,
			Findings: []string{},
		}
	}

	agentName := agent.Config().Name

	r.mu.Lock()
	r.running[agentName] = true
	r.mu.Unlock()
	r.registry.SetStatus(agentName, "running")

	ctx, cancel := context.WithTimeout(context.Background(), r.timeout)
	defer cancel()

	resultCh := make(chan AgentResult, 1)
	go func() {
		resultCh <- agent.Execute(task)
	}()

	var result AgentResult
	select {
	case result = <-resultCh:
	case <-ctx.Done():
		result = AgentResult{
			AgentName: agentName,
			TaskID:    task.ID,
			Success:   false,
			Error:     "task timed out",
			Findings:  []string{},
		}
	}

	r.mu.Lock()
	r.running[agentName] = false
	r.mu.Unlock()

	if result.Success {
		r.registry.IncrementCompleted(agentName)
		r.registry.SetStatus(agentName, "idle")
	} else {
		r.registry.IncrementFailed(agentName)
		r.registry.SetStatus(agentName, "error")
	}

	return result
}

// Registry returns the registry associated with this runner.
func (r *Runner) Registry() *Registry {
	return r.registry
}

// RunParallel dispatches multiple tasks concurrently via goroutines.
func (r *Runner) RunParallel(tasks []AgentTask) []AgentResult {
	results := make([]AgentResult, len(tasks))
	var wg sync.WaitGroup

	for i, task := range tasks {
		wg.Add(1)
		go func(idx int, t AgentTask) {
			defer wg.Done()
			results[idx] = r.Run(t)
		}(i, task)
	}

	wg.Wait()
	return results
}
