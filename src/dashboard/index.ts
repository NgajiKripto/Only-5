export { DashboardServer } from "./server.js";
export type { DashboardConfig } from "./server.js";
export { WebSocketServer, encodeFrame, computeAcceptKey } from "./websocket.js";
export { getDashboardHTML } from "./static.js";

import { DashboardServer } from "./server.js";
import type { DashboardConfig } from "./server.js";

export function createDashboard(config?: DashboardConfig): DashboardServer {
  return new DashboardServer(config);
}
