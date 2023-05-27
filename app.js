/**
 * ===========================
 *        IEDON-PEERAPI       
 *          Bootstrap         
 * ===========================
 */

const package = require('./package.json');
const app = new (require('koa'))();
require('koa-onerror')(app);
app.use(require('koa-bodyparser')());

let settings = require('./config');

const { logger } = require('./providers/logger/logger');
const { mail } = require('./providers/mail/mail');
const { whois } = require('./providers/whois/whois');
const { fetch } = require('./providers/fetch/fetch');
const { dbContext } = require('./db/dbContext');
const { core } = require('./providers/core/core');

app.settings = settings;
app.use(logger(app, settings.loggerSettings));
const appLogger = app.logger.getLogger('app');

const initAcorle = async () => {
  const acorleLogger = app.logger.getLogger('acorle');

  const { acorleKoa } = require('./acorle-sdk/acorleKoa');
  app.use(acorleKoa(app,
    settings.acorle.centerServerUrl,
    settings.acorle.zone,
    settings.acorle.secret,
    settings.acorle.regIntervalSeconds,
    (level, log) => {
      switch (level) {
        case 'warn': return acorleLogger.warn(log);
        case 'error': return acorleLogger.error(log);
        case 'debug': return acorleLogger.debug(log);
        case 'trace': return acorleLogger.trace(log);
        case 'info': return acorleLogger.info(log);
        default: case 'log': return acorleLogger.log(log);
      }
    }
  ));

  if (settings.acorle.retriveConfigFromCenterServer) {
    appLogger.info(`[acorle.retriveConfigFromCenterServer] is ON. Retriving configuration with key \"${settings.acorle.configKey}\" from center server...`);
    const config = await app.acorle.getConfig(settings.acorle.configKey);
    if (config && config.context) {
      try {
        const newSettings = {
          loggerSettings: settings.loggerSettings,
          acorle: settings.acorle
        };
        Object.assign(newSettings, JSON.parse(config.context));
        settings = newSettings;
        app.settings = settings;
      } catch (error) {
        appLogger.error('Failed to parse / malformed configuration retrived from center server. Continuing with local file.');
      }
    } else {
      appLogger.error('Failed to retrive configuration from center server. Continuing with local file.');
    }
  }
}

const initMiddlewares = () => {
  app.use(dbContext(app, settings.dbSettings));
  app.use(mail(app, settings.mailSettings));
  app.use(whois(app, settings.whoisSettings));
  app.use(fetch(app, settings.fetchSettings));
  app.use(core(app, settings.tokenSettings));

  const routes = require('./routes');
  app.use(routes.routes(), routes.allowedMethods());

  if (settings.acorle.enabled) {
    // Register all routes as microservice to acorle
    const { AcorleService } = require('./acorle-sdk/acorleKoa');
    const services = [];
    routes.routes().router.stack.map(r => services.push(new AcorleService(r.path.replace('/', ''), `${settings.acorle.localUrl}${r.path}`, `PeerAPI ${r.path.replace('/', '')}`, false)));
    app.acorle.registerServices(services);
  }
}

(async () => {
  appLogger.info(`${package.name}/${package.version} started.`);
  if (settings.acorle.enabled) await initAcorle();
  initMiddlewares();
})();

module.exports = app;
