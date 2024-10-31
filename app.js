/**
 * ===========================
 *        IEDON-PEERAPI       
 *          Bootstrap         
 * ===========================
 */

import pkg from './package.json' assert { type: 'json' };
import localSettings from './config.js';

import { useLogger } from './providers/logger/logger.js';
import { useMail } from './providers/mail/mail.js';
import { useWhois } from './providers/whois/whois.js';
import { useFetch } from './providers/fetch/fetch.js';
import { useDbContext } from './db/dbContext.js';
import { useCore } from './providers/core/core.js';
import { useRouter } from './routes.js';

import fs from 'fs';

import { Hono } from 'hono';

const app  = {
  server: new Hono(),
  settings: localSettings
};

(async () => {

  await useLogger(app, localSettings.loggerSettings);
  app.logger.getLogger('app').info(`${pkg.name}/${pkg.version} started.`);

  if (localSettings.acorle.enabled) await initAcorle(app);

  // Init dependencies
  useDbContext(app, app.settings.dbSettings);
  useMail(app, app.settings.mailSettings);
  useWhois(app, app.settings.whoisSettings);
  useFetch(app, app.settings.fetchSettings);

  // Init core middleware
  useCore(app, app.settings.tokenSettings);

  // Init handlers
  useRouter(app, app.settings.handlers);
})();


const initAcorle = async app => {
  const appLogger = app.logger.getLogger('app');
  const acorleLogger = app.logger.getLogger('acorle');

  const Acorle = await import('./acorle-sdk/acorleKoa.js');
  app.server.use(Acorle.acorleKoa(app,
    localSettings.acorle.centerServerUrl,
    localSettings.acorle.zone,
    localSettings.acorle.secret,
    localSettings.acorle.regIntervalSeconds,
    (level, log) => acorleLogger[level](log)
  ));

  if (localSettings.acorle.retriveConfigFromCenterServer) {
    appLogger.info(`[acorle.retriveConfigFromCenterServer] is ON. Retriving configuration with key \"${localSettings.acorle.configKey}\" from center server...`);
    const config = await app.acorle.getConfig(localSettings.acorle.configKey);
    if (config && config.context) {
      try {
        const newSettings = {
          listenPort: localSettings.listenPort,
          loggerSettings: localSettings.loggerSettings,
          acorle: localSettings.acorle,
          handlers: localSettings.handlers
        };
        Object.assign(newSettings, JSON.parse(config.context));
        app.settings = newSettings;
      } catch (error) {
        appLogger.error('Failed to parse / malformed configuration retrived from center server. Continuing with local file.');
      }
    } else {
      appLogger.error('Failed to retrive configuration from center server. Continuing with local file.');
    }
  }

  if (localSettings.acorle.enabled) {
    // Register as microservice to acorle
    app.acorle.registerServices([
      new Acorle.AcorleService(
        localSettings.acorle.serviceKey,
        localSettings.acorle.localUrl,
        localSettings.acorle.serviceName, false)
    ]);
  }
};

const module = {
  fetch: app.server.fetch,
  port: localSettings.listen.port,
  hostname: localSettings.hostname
};

if (localSettings.listen.type === 'unix') 
  Object.assign(module, { unix: localSettings.listen.path });

export default module;
