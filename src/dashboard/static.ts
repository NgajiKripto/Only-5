export function getDashboardHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Only-5 Agent Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 20px;
    }
    h1 { color: #00d4aa; margin-bottom: 20px; }
    h2 { color: #7c83ff; margin-bottom: 10px; font-size: 1.1rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .card {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 16px;
    }
    .status-ok { color: #00d4aa; }
    .status-error { color: #ff6b6b; }
    .metric { display: flex; justify-content: space-between; padding: 4px 0; }
    .metric-label { color: #a0a0a0; }
    .metric-value { font-weight: bold; }
    .ws-status {
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.8rem;
    }
    .ws-connected { background: #00d4aa33; color: #00d4aa; }
    .ws-disconnected { background: #ff6b6b33; color: #ff6b6b; }
    pre { background: #0f3460; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="ws-status ws-disconnected" id="wsStatus">Disconnected</div>
  <h1>Only-5 Agent Dashboard</h1>
  <div class="grid">
    <div class="card">
      <h2>Agent Status</h2>
      <div id="statusContent"><pre>Loading...</pre></div>
    </div>
    <div class="card">
      <h2>Metrics</h2>
      <div id="metricsContent"><pre>Loading...</pre></div>
    </div>
    <div class="card">
      <h2>Active Strategies</h2>
      <div id="strategiesContent"><pre>Loading...</pre></div>
    </div>
    <div class="card">
      <h2>Memory Stats</h2>
      <div id="memoryContent"><pre>Loading...</pre></div>
    </div>
  </div>
  <script>
    const port = ${port};
    let ws = null;
    let pollInterval = null;

    function updateSection(id, data) {
      const el = document.getElementById(id);
      if (!el) return;
      if (typeof data === 'object' && data !== null) {
        el.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
      } else {
        el.innerHTML = '<pre>' + String(data) + '</pre>';
      }
    }

    function setWsStatus(connected) {
      const el = document.getElementById('wsStatus');
      if (connected) {
        el.textContent = 'Connected';
        el.className = 'ws-status ws-connected';
      } else {
        el.textContent = 'Disconnected';
        el.className = 'ws-status ws-disconnected';
      }
    }

    async function fetchData() {
      try {
        const [status, metrics, strategies, memory] = await Promise.all([
          fetch('/api/status').then(r => r.json()).catch(() => null),
          fetch('/api/metrics').then(r => r.json()).catch(() => null),
          fetch('/api/strategies').then(r => r.json()).catch(() => null),
          fetch('/api/memory/stats').then(r => r.json()).catch(() => null),
        ]);
        if (status) updateSection('statusContent', status);
        if (metrics) updateSection('metricsContent', metrics);
        if (strategies) updateSection('strategiesContent', strategies);
        if (memory) updateSection('memoryContent', memory);
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function connectWebSocket() {
      try {
        ws = new WebSocket('ws://localhost:' + port);
        ws.onopen = function() {
          setWsStatus(true);
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        };
        ws.onmessage = function(event) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'status') updateSection('statusContent', msg.data);
            else if (msg.type === 'metrics') updateSection('metricsContent', msg.data);
            else if (msg.type === 'strategies') updateSection('strategiesContent', msg.data);
            else if (msg.type === 'memory') updateSection('memoryContent', msg.data);
            else updateSection('statusContent', msg);
          } catch (e) {
            console.error('WS parse error:', e);
          }
        };
        ws.onclose = function() {
          setWsStatus(false);
          startPolling();
          setTimeout(connectWebSocket, 5000);
        };
        ws.onerror = function() {
          setWsStatus(false);
        };
      } catch (e) {
        startPolling();
      }
    }

    function startPolling() {
      if (!pollInterval) {
        pollInterval = setInterval(fetchData, 10000);
      }
    }

    fetchData();
    connectWebSocket();
  </script>
</body>
</html>`;
}
