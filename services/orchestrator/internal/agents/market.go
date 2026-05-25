package agents

import (
	"fmt"
	"time"
)

// MarketAgent handles market analysis operations.
type MarketAgent struct{}

func (a *MarketAgent) Config() AgentConfig {
	return AgentConfig{
		Name:         "market-agent",
		Description:  "Performs market analysis including price checks, sentiment analysis, and trend detection",
		Capabilities: []string{"price-check", "sentiment-analysis", "trend-detection"},
		Priority:     7,
	}
}

func (a *MarketAgent) Execute(task AgentTask) AgentResult {
	start := time.Now()

	var findings []string
	var data interface{}

	switch task.Type {
	case "price-check":
		findings = []string{
			fmt.Sprintf("checked price for %s", task.Target),
			"current price: $145.32",
			"24h change: +3.2%",
		}
		data = map[string]interface{}{
			"price":     145.32,
			"change_24h": 3.2,
			"currency":  "USD",
		}
	case "sentiment-analysis":
		findings = []string{
			fmt.Sprintf("analyzed sentiment for %s", task.Target),
			"overall sentiment: bullish",
			"social volume: high",
		}
		data = map[string]interface{}{
			"sentiment":     "bullish",
			"score":         0.72,
			"social_volume": "high",
		}
	case "trend-detection":
		findings = []string{
			fmt.Sprintf("detected trends for %s", task.Target),
			"uptrend confirmed on 4h timeframe",
			"support level: $138.50",
		}
		data = map[string]interface{}{
			"trend":   "uptrend",
			"support": 138.50,
			"resistance": 152.00,
		}
	default:
		return AgentResult{
			AgentName: "market-agent",
			TaskID:    task.ID,
			Success:   false,
			Error:     "unsupported task type: " + task.Type,
			Duration:  time.Since(start).Milliseconds(),
			Findings:  []string{},
		}
	}

	return AgentResult{
		AgentName: "market-agent",
		TaskID:    task.ID,
		Success:   true,
		Data:      data,
		Duration:  time.Since(start).Milliseconds(),
		Findings:  findings,
	}
}
