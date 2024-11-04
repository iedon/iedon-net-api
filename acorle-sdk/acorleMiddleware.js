'use strict';

import pkg from './package.json' with { type: "json" };
import { AcorleClient } from './acorle.js';

const FULL_NAME = 'Acorle Microservices';
const FRAMEWORK_NAME = `acorle-koa/${pkg.version}`;

export function acorleMiddleware(app, centerServerUrl, zone, secret, regIntervalSeconds, customLogFunc, customRequestFunc) {
  app.acorle = new AcorleClient(zone, secret, regIntervalSeconds, centerServerUrl, customLogFunc, customRequestFunc);
  return async (c, next) => {

    if (c.req.path === '/') {
      return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>${FULL_NAME}</title></head><body style="padding:50px;font: 14px \'Lucida Grande\', \'Lucida Sans Unicode\', Helvetica, Arial, Verdana, sans-serif;"><h1>${FULL_NAME}</h1><p>Welcome to ${FULL_NAME}, the integrated microservice solution.</p><hr><p><span>Client SDK:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${pkg.name}/${pkg.version}</code></b></p><p><span>Framework:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${FRAMEWORK_NAME}</code></b></p><p><span>Configured services:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${app.acorle.services.length}</code></b></p><p><span>Registration status:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${app.acorle.status}</code></b></p><hr><address>Copyright &copy; 2019-${new Date().getFullYear()} ${pkg.author}</address></body></html>`);
    }

    await next();
  };
}

export { AcorleService } from './acorle.js';
