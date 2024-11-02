export async function useToken(app, tokenSettings = {}) {
  const providerName = tokenSettings.provider || 'default';
  const handlerName = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}TokenProvider`;

  try {
    const { [handlerName]: TokenProvider } = await import(`./${providerName}TokenProvider.js`);
    app.token = new TokenProvider(app, tokenSettings);
  } catch (error) {
    app.logger.getLogger('app').error(`Failed to load token provider: ${handlerName}`, error);
  }
};