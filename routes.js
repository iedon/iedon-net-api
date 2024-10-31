import adminHandler from './handlers/admin.js';
import authHandler from './handlers/auth.js';
import listHandler from './handlers/list.js';
import tokenHandler from './handlers/token.js';
import sessionHandler from './handlers/session.js';
import settingsHandler from './handlers/settings.js';

export function registerRoutes(app) {
  app.server.post('/admin', adminHandler)
  .post('/auth', authHandler)
  .get('/list/:type/:postId?', listHandler)
  .get('/token', tokenHandler)
  .post('/session', sessionHandler)
  .post('/settings', settingsHandler);
}
