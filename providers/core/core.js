import { makeResponse, RESPONSE_CODE } from "../../common/packet.js";
import { nullOrEmpty } from '../../common/helper.js';

export async function useCore(app, tokenSettings = {}) {
  const providerName = tokenSettings.provider || 'default';
  const handlerName = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}TokenProvider`;
  
  try {
    const { [handlerName]: TokenProvider } = await import(`./${providerName}TokenProvider.js`);
    app.token = new TokenProvider(app, tokenSettings);
  } catch (error) {
    console.error(`Failed to load token provider: ${handlerName}`, error);
    throw new Error(`Token provider ${handlerName} could not be loaded.`);
  }

  app.server.use(async (c, next) => {
    c.set('app', app);

    setSecurityHeaders(c);
    setCustomHeaders(c, app.settings.customHeaders);

    if (c.req.method === 'OPTIONS') {
      handlePreflightRequest(c, app.settings.corsHeaders);
      return c.text('');
    }

    if (c.req.method !== 'POST') {
      return makeResponse(c, RESPONSE_CODE.METHOD_NOT_ALLOWED);
    }

    try {
      c.set('body', (await c.req.json()) || {});
    } catch (error) {
      // Bad request body / io error
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (isPublicUrl(c.req.path)) {
      await next();
      return;
    }

    if (nullOrEmpty(c.var.body.token)) {
      return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
    }

    try {
      const state = await verifyAndGetState(app, c.var.body.token);
      if (!state) {
        return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
      }
      c.set('state', state);

      await next();

      const nextToken = await app.token.generateToken({
        asn: state.asn,
        person: state.person
      });

      if (nextToken) Object.assign(c.body, { token: nextToken });
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

function handlePreflightRequest(c, corsHeaders) {
  setCustomHeaders(c, corsHeaders);
  c.status(204);
}

function isPublicUrl(url) {
  return url === '/auth' || url === '/list';
}

async function verifyAndGetState(app, token) {
  const state = await app.token.verify(token);
  if (!state || nullOrEmpty(state.asn)) {
    return null;
  }
  return state;
}