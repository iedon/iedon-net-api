export async function useLogger(app, loggerSettings = {}) {
  const providerName = loggerSettings.provider || 'default';
  const handlerName = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}LoggerProvider`;

  try {
    const { [handlerName]: LoggerProvider } = await import(`./${providerName}LoggerProvider.js`);
    app.logger = new LoggerProvider(app, loggerSettings);
  } catch (error) {
    app.logger = new DefaultLogger(app, loggerSettings);
    app.logger.getLogger('app').error(`Logger provider ${handlerName} could not be loaded. Fall back to default provider.`);
  }
}