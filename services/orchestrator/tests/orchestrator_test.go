package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/agents"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/handlers"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/session"
	"github.com/NgajiKripto/Only-5/services/orchestrator/internal/streaming"
)

func setupRegistry() *agents.Registry {
	registry := agents.NewRegistry()
	registry.Register(&agents.SecurityAgent{})
	registry.Register(&agents.DeFiAgent{})
	registry.Register(&agents.MarketAgent{})
	registry.Register(&agents.BountyAgent{})
	return registry
}

func setupServer() *httptest.Server {
	registry := setupRegistry()
	runner := agents.NewRunner(registry, 30*time.Second)
	streamMgr := streaming.NewManager(100)
	sessionMgr := session.NewManager(1 * time.Hour)
	server := handlers.NewServer(runner, streamMgr, sessionMgr)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)
	return httptest.NewServer(mux)
}

func TestAgentRegistration(t *testing.T) {
	registry := setupRegistry()

	statuses := registry.List()
	if len(statuses) != 4 {
		t.Errorf("expected 4 agents registered, got %d", len(statuses))
	}

	agent, ok := registry.Get("security-agent")
	if !ok {
		t.Fatal("expected security-agent to be registered")
	}
	if agent.Config().Priority != 10 {
		t.Errorf("expected priority 10, got %d", agent.Config().Priority)
	}
}

func TestFindByCapability(t *testing.T) {
	registry := setupRegistry()

	found := registry.FindByCapability("security-scan")
	if len(found) != 1 {
		t.Errorf("expected 1 agent for security-scan, got %d", len(found))
	}
	if found[0].Config().Name != "security-agent" {
		t.Errorf("expected security-agent, got %s", found[0].Config().Name)
	}

	found = registry.FindByCapability("nonexistent")
	if len(found) != 0 {
		t.Errorf("expected 0 agents for nonexistent capability, got %d", len(found))
	}
}

func TestFindBest(t *testing.T) {
	registry := setupRegistry()

	best := registry.FindBest("security-scan")
	if best == nil {
		t.Fatal("expected to find an agent for security-scan")
	}
	if best.Config().Name != "security-agent" {
		t.Errorf("expected security-agent, got %s", best.Config().Name)
	}

	best = registry.FindBest("token-swap")
	if best == nil {
		t.Fatal("expected to find an agent for token-swap")
	}
	if best.Config().Name != "defi-agent" {
		t.Errorf("expected defi-agent, got %s", best.Config().Name)
	}
}

func TestRunTask(t *testing.T) {
	registry := setupRegistry()
	runner := agents.NewRunner(registry, 30*time.Second)

	task := agents.AgentTask{
		ID:     "test-task-1",
		Type:   "security-scan",
		Target: "example.com",
	}

	result := runner.Run(task)
	if !result.Success {
		t.Errorf("expected success, got error: %s", result.Error)
	}
	if result.AgentName != "security-agent" {
		t.Errorf("expected security-agent, got %s", result.AgentName)
	}
	if result.TaskID != "test-task-1" {
		t.Errorf("expected task ID test-task-1, got %s", result.TaskID)
	}
}

func TestRunTaskNoAgent(t *testing.T) {
	registry := setupRegistry()
	runner := agents.NewRunner(registry, 30*time.Second)

	task := agents.AgentTask{
		ID:   "test-task-2",
		Type: "nonexistent-capability",
	}

	result := runner.Run(task)
	if result.Success {
		t.Error("expected failure for nonexistent capability")
	}
	if result.Error == "" {
		t.Error("expected error message")
	}
}

func TestRunParallel(t *testing.T) {
	registry := setupRegistry()
	runner := agents.NewRunner(registry, 30*time.Second)

	tasks := []agents.AgentTask{
		{ID: "p-1", Type: "security-scan", Target: "target-a"},
		{ID: "p-2", Type: "token-swap", Target: "SOL/USDC"},
		{ID: "p-3", Type: "price-check", Target: "SOL"},
		{ID: "p-4", Type: "bounty-search", Target: "protocol-x"},
	}

	results := runner.RunParallel(tasks)
	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}

	for i, result := range results {
		if !result.Success {
			t.Errorf("task %d failed: %s", i, result.Error)
		}
	}

	// Verify correct agent handled each task
	if results[0].AgentName != "security-agent" {
		t.Errorf("expected security-agent for task 0, got %s", results[0].AgentName)
	}
	if results[1].AgentName != "defi-agent" {
		t.Errorf("expected defi-agent for task 1, got %s", results[1].AgentName)
	}
	if results[2].AgentName != "market-agent" {
		t.Errorf("expected market-agent for task 2, got %s", results[2].AgentName)
	}
	if results[3].AgentName != "bounty-agent" {
		t.Errorf("expected bounty-agent for task 3, got %s", results[3].AgentName)
	}
}

func TestSessionCreateAndGet(t *testing.T) {
	mgr := session.NewManager(1 * time.Hour)

	sess := mgr.Create()
	if sess.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if sess.Status != "active" {
		t.Errorf("expected status active, got %s", sess.Status)
	}

	retrieved, ok := mgr.Get(sess.ID)
	if !ok {
		t.Fatal("expected to find session")
	}
	if retrieved.ID != sess.ID {
		t.Errorf("expected ID %s, got %s", sess.ID, retrieved.ID)
	}
}

func TestSessionList(t *testing.T) {
	mgr := session.NewManager(1 * time.Hour)

	mgr.Create()
	mgr.Create()
	mgr.Create()

	sessions := mgr.List()
	if len(sessions) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestSessionAddTask(t *testing.T) {
	mgr := session.NewManager(1 * time.Hour)

	sess := mgr.Create()
	mgr.AddTask(sess.ID, "task-1")
	mgr.AddTask(sess.ID, "task-2")

	retrieved, _ := mgr.Get(sess.ID)
	if len(retrieved.Tasks) != 2 {
		t.Errorf("expected 2 tasks, got %d", len(retrieved.Tasks))
	}
}

func TestSessionExpiry(t *testing.T) {
	mgr := session.NewManager(1 * time.Millisecond)

	sess := mgr.Create()
	time.Sleep(5 * time.Millisecond)

	_, ok := mgr.Get(sess.ID)
	if ok {
		t.Error("expected session to be expired")
	}
}

func TestSessionCleanup(t *testing.T) {
	mgr := session.NewManager(1 * time.Millisecond)

	mgr.Create()
	mgr.Create()
	time.Sleep(5 * time.Millisecond)

	mgr.Cleanup()
	sessions := mgr.List()
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions after cleanup, got %d", len(sessions))
	}
}

func TestStreamingSubscribeAndBroadcast(t *testing.T) {
	mgr := streaming.NewManager(10)

	ch := mgr.Subscribe("test-session")

	event := streaming.Event{
		ID:        "evt-1",
		Type:      streaming.EventAgentStarted,
		Timestamp: time.Now().Unix(),
		SessionID: "test-session",
		Data:      "test data",
	}
	mgr.Broadcast(event)

	select {
	case received := <-ch:
		if received.ID != "evt-1" {
			t.Errorf("expected event ID evt-1, got %s", received.ID)
		}
		if received.Type != streaming.EventAgentStarted {
			t.Errorf("expected event type agent_started, got %s", received.Type)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestStreamingUnsubscribe(t *testing.T) {
	mgr := streaming.NewManager(10)

	mgr.Subscribe("test-session")
	mgr.Unsubscribe("test-session")

	if mgr.SubscriberCount() != 0 {
		t.Errorf("expected 0 subscribers after unsubscribe, got %d", mgr.SubscriberCount())
	}
}

func TestStreamingBuffer(t *testing.T) {
	mgr := streaming.NewManager(3)

	for i := 0; i < 5; i++ {
		mgr.Broadcast(streaming.Event{
			ID:   "evt-" + string(rune('a'+i)),
			Type: streaming.EventTaskDispatched,
		})
	}

	buffer := mgr.GetBuffer()
	if len(buffer) != 3 {
		t.Errorf("expected buffer size 3, got %d", len(buffer))
	}
}

func TestHealthEndpoint(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("health request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&body)
	if body["status"] != "healthy" {
		t.Errorf("expected status healthy, got %v", body["status"])
	}
	if body["service"] != "orchestrator" {
		t.Errorf("expected service orchestrator, got %v", body["service"])
	}
}

func TestAgentsEndpoint(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/agents")
	if err != nil {
		t.Fatalf("agents request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&body)
	agentsList, ok := body["agents"].([]interface{})
	if !ok {
		t.Fatal("expected agents array in response")
	}
	if len(agentsList) != 4 {
		t.Errorf("expected 4 agents, got %d", len(agentsList))
	}
}

func TestDispatchEndpoint(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	task := agents.AgentTask{
		ID:     "http-task-1",
		Type:   "security-scan",
		Target: "test-target",
	}
	body, _ := json.Marshal(task)

	resp, err := http.Post(ts.URL+"/dispatch", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("dispatch request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result agents.AgentResult
	json.NewDecoder(resp.Body).Decode(&result)
	if !result.Success {
		t.Errorf("expected success, got error: %s", result.Error)
	}
	if result.AgentName != "security-agent" {
		t.Errorf("expected security-agent, got %s", result.AgentName)
	}
}

func TestDispatchParallelEndpoint(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	payload := map[string]interface{}{
		"tasks": []agents.AgentTask{
			{ID: "hp-1", Type: "security-scan", Target: "a"},
			{ID: "hp-2", Type: "price-check", Target: "b"},
		},
	}
	body, _ := json.Marshal(payload)

	resp, err := http.Post(ts.URL+"/dispatch/parallel", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("parallel dispatch request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	results, ok := result["results"].([]interface{})
	if !ok {
		t.Fatal("expected results array")
	}
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}
}

func TestSessionsEndpoint(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	// Create session
	resp, err := http.Post(ts.URL+"/sessions", "application/json", nil)
	if err != nil {
		t.Fatalf("create session request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}

	var sess map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&sess)
	sessionID, ok := sess["id"].(string)
	if !ok || sessionID == "" {
		t.Fatal("expected non-empty session ID")
	}

	// Get session
	resp2, err := http.Get(ts.URL + "/sessions/" + sessionID)
	if err != nil {
		t.Fatalf("get session request failed: %v", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp2.StatusCode)
	}

	var retrieved map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&retrieved)
	if retrieved["id"] != sessionID {
		t.Errorf("expected session ID %s, got %v", sessionID, retrieved["id"])
	}
}

func TestSessionNotFound(t *testing.T) {
	ts := setupServer()
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/sessions/nonexistent-id")
	if err != nil {
		t.Fatalf("get session request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
