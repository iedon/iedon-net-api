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
import { useFetch } from './providers/fetch/fetch.js'
import { useToken } from './providers/token/token.js';
import { useSshAuthServer } from './providers/ssh/sshAuthServer.js';
import { useDbContext } from './db/dbContext.js';

import { registerRoutes } from './routes.js';
import { entryMiddleware } from './entry.js';

import { Hono } from 'hono';

// Initialize app object
const app = {
  server: new Hono(),
  settings: localSettings,
  ready: false
};

// Initialize routes and core middleware
entryMiddleware(app, app.settings.tokenSettings);
registerRoutes(app);

// Main async function to bootstrap the application
(async () => {
  try {
    // Initialize logger
    await useLogger(app, localSettings.loggerSettings);
    const appLogger = app.logger.getLogger('app');
    appLogger.info(`${pkg.name}/${pkg.version} started.`);

    // Initialize Acorle if enabled
    if (localSettings.acorle.enabled) {
      await initAcorle(app);
    }

    // Initialize dependencies
    await Promise.all([
      useDbContext(app, app.settings.dbSettings),
      useMail(app, app.settings.mailSettings),
      useWhois(app, app.settings.whoisSettings),
      useFetch(app, app.settings.fetchSettings),
      useToken(app, app.settings.tokenSettings),
      useSshAuthServer(app, app.settings.sshAuthServerSettings),
    ]);

    app.ready = true;
  } catch (error) {
    console.error('Error during bootstrap: ', error);
  }
})();

// Function to initialize Acorle middleware
const initAcorle = async app => {
  const appLogger = app.logger.getLogger('app');
  const acorleLogger = app.logger.getLogger('acorle');

  try {
    // Dynamically import Acorle middleware only when needed
    const { acorleMiddleware, AcorleService } = await import('./acorle-sdk/acorleMiddleware.js');

    // Apply Acorle middleware to the server
    app.server.use(acorleMiddleware(
      app,
      localSettings.acorle.centerServerUrl,
      localSettings.acorle.zone,
      localSettings.acorle.secret,
      localSettings.acorle.regIntervalSeconds,
      (level, log) => acorleLogger[level](log)
    ));

    // Retrieve configuration from center server if enabled
    if (localSettings.acorle.retriveConfigFromCenterServer) {
      await retrieveAcorleConfig(app);
    }

    // Register services with Acorle if enabled
    if (localSettings.acorle.enabled) {
      registerAcorleServices(app, AcorleService);
    }

  } catch (error) {
    appLogger.error('Error initializing Acorle:', error);
  }
};

// Function to retrieve Acorle configuration from the center server
const retrieveAcorleConfig = async app => {
  const appLogger = app.logger.getLogger('app');

  try {
    const config = await app.acorle.getConfig(localSettings.acorle.configKey);

    if (config && config.context) {
      const newSettings = {
        ...localSettings,
        ...JSON.parse(config.context),
      };
      app.settings = newSettings;
      appLogger.info('Configuration retrieved and applied successfully.');

    } else {
      throw new Error('Empty or invalid configuration received.');
    }

  } catch (error) {
    appLogger.error(`Failed to retrieve configuration: ${error.message}. Continuing with local file.`);
  }
};

// Function to register services with Acorle
const registerAcorleServices = (app, AcorleService) => {
  const { acorle } = localSettings;

  try {
    // Register as a microservice to Acorle
    app.acorle.registerServices([
      new AcorleService(
        acorle.serviceKey,
        acorle.localUrl,
        acorle.serviceName,
        false
      ),
    ]);

  } catch (error) {
    const acorleLogger = app.logger.getLogger('acorle');
    acorleLogger.error(`Failed to register services with Acorle: ${error.message}`);
  }
};

// Export module with server fetch method and other settings
const module = {
  fetch: app.server.fetch,
  port: localSettings.listen.port,
  hostname: localSettings.listen.hostname,
};

// Add Unix socket path if applicable
if (localSettings.listen.type === 'unix') {
  module.unix = localSettings.listen.path;
}

export default module;