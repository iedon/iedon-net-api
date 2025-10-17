import adminHandler from './handlers/admin.js';
import authHandler from './handlers/auth.js';
import listHandler from './handlers/list.js';
import tokenHandler from './handlers/token.js';
import peeringHandler from './handlers/peering.js';
import settingsHandler from './handlers/settings.js';
import agentHandler from './handlers/agent.js';
import metricsHandler from './handlers/metrics.js';

export function registerRoutes(app) {
  app.server.post('/admin', adminHandler)
  .post('/auth', authHandler)
  .get('/list/:type/:postId?', listHandler)
  .get('/token', tokenHandler)
  .post('/session', peeringHandler)
  .post('/settings', settingsHandler)
  .get('/agent/:router/:action', agentHandler)
  .post('/agent/:router/:action', agentHandler)
  .get('/metrics', metricsHandler);
}
