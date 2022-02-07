'use strict';

const pkg = require('./package.json')
const { AcorleClient, ResponseCodeType, AcorleService } = require('./acorle');
const getRawBody = require('raw-body');

const FULL_NAME = 'Acorle Microservices';
const FRAMEWORK_NAME = `acorle-koa/${pkg.version}`;

module.exports = {
  acorleKoa: (app, centerServerUrl, zone, secret, regIntervalSeconds, customLogFunc, customRequestFunc) => {
    app.acorle = new AcorleClient(zone, secret, regIntervalSeconds, centerServerUrl, customLogFunc, customRequestFunc);
    return async (ctx, next) => {

      if (ctx.request.url === '/') {
        ctx.body = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>${FULL_NAME}</title></head><body style="padding:50px;font: 14px \'Lucida Grande\', \'Lucida Sans Unicode\', Helvetica, Arial, Verdana, sans-serif;"><h1>${FULL_NAME}</h1><p>Welcome to ${FULL_NAME}, the integrated microservice solution.</p><hr><p><span>Client SDK:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${pkg.name}/${pkg.version}</code></b></p><p><span>Framework:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${FRAMEWORK_NAME}</code></b></p><p><span>Configured services:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${ctx.app.acorle.services.length}</code></b></p><p><span>Registration status:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b><code>${ctx.app.acorle.status}</code></b></p><hr><address>Copyright &copy; 2019-${new Date().getFullYear()} ${pkg.author}</address></body></html>`;
        ctx.status = 200;
        ctx.response.message = 'OK';
        ctx.response.type = 'html';
        return;
      }

      if (ctx.request.method !== 'POST') return await next();
      let data = null;
      try {
        ctx.request.body = await getRawBody(ctx.req, {
          length: ctx.req.headers['content-length'],
          limit: '4mb',
        });

        data = ctx.app.acorle.getRequestData(ctx.request.body);
        try {
          ctx.request.method = data.remoteHeaders['x-http-method'][0];
        } finally {
          ctx.acorle = {
            remoteIp: data.remoteIp,
            remotePort: data.remotePort,
            remoteHeaders: data.remoteHeaders
          };
        }

      } catch (err) {
        ctx.body = Buffer.from(ctx.app.acorle.makeResponsePacket(ResponseCodeType.BAD_REQUEST));
        ctx.set('Content-Type', 'application/x-protobuf');
        ctx.status = 200;
        ctx.response.message = 'OK';
        return;
      }

      ctx.request.body = data.data;

      const headers = new Map();
      ctx.acorleSetHeader = (key, value) => {
        if (headers.has(key)) {
          const arr = headers.get(key);
          if (arr) {
            if (Array.isArray(value)) {
              value.forEach(e => arr.push(e));
            } else {
              arr.push(value);
            }
          }
        } else {
          if (Array.isArray(value)) {
            headers.set(key, value);
          } else {
            headers.set(key, [ value ]);
          }
        }
      }
      ctx.originalSet = ctx.set;
      ctx.set = ctx.acorleSetHeader;

      await next();

      ctx.acorleSetHeader('Status', `${ctx.status || 200}`);
      for (const header in ctx.response.headers) ctx.acorleSetHeader(header, ctx.response.headers[header]);

      ctx.status = 200;
      ctx.response.message = 'OK';
      ctx.body = Buffer.from(ctx.app.acorle.makeResponsePacket(
        ResponseCodeType.OK,
        ctx.body,
        headers
      ));
      ctx.originalSet('Content-Type', 'application/x-protobuf');
    };
  },
  AcorleService
};
