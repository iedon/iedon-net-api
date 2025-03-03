import { makeResponse, RESPONSE_CODE } from "./common/packet.js";
import { nullOrEmpty } from './common/helper.js';

export function requestMiddleware(app) {
  app.server.use(async (c, next) => {
    c.set('app', app);

    setSecurityHeaders(c);
    setCustomHeaders(c, app.settings.corsHeaders);
    setCustomHeaders(c, app.settings.customHeaders);

    if (!app.ready) {
      return makeResponse(c, RESPONSE_CODE.SERVICE_UNAVAILABLE);
    }

    if (c.req.method === 'OPTIONS') {
      return handlePreflightRequest(c, app.settings.preflightHeaders);
    }

    if (c.req.method === 'POST') {
      if (Number(c.req.header('Content-Length')) > 1048576) {
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
      }

      try {
        c.set('body', (await c.req.json()) || {});
      } catch (error) {
        // Bad request body / io error
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
      }
    }

    if (isPublicUrl(c.req.path)) {
      await next();
      return;
    }

    try {
      const state = await verifyAndGetState(app, c);
      if (!state) {
        return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
      }

      c.set('state', state);

      await next();
    } catch (error) {
      app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
  });
}

function setSecurityHeaders(c) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Download-Options': 'noopen',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-store, no-cache'
  };
  Object.entries(headers).forEach(([key, value]) => c.header(key, value));
}

function setCustomHeaders(c, customHeaders) {
  Object.entries(customHeaders).forEach(([key, value]) => c.header(key, value));
}

function handlePreflightRequest(c, preflightHeaders) {
  setCustomHeaders(c, preflightHeaders);
  c.status(204);
  return c.text('');
}

function isPublicUrl(url) {
  return url === '/auth' || url.startsWith('/list/');
}

async function verifyAndGetState(app, c) {
  const header = c.req.header('Authorization');
  if (!header) return null;

  const token = header.split('Bearer\x20')[1];
  if (!token) return null;

  const state = await app.token.verify(token);
  if (!state || nullOrEmpty(state.asn)) {
    return null;
  }
  return state;
}