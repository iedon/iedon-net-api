export async function useOpenAuth(app, openAuthSettings = {}) {
  app.openAuthProviders = {};
  if (!openAuthSettings.providers || !Array.isArray(openAuthSettings.providers)) return;
  
  for (let i = 0; i < openAuthSettings.providers.length; i++) {
    const p = openAuthSettings.providers[i];
    const handlerName = `${p.charAt(0).toUpperCase()}${p.slice(1)}OpenAuthProvider`;
    try {
      const { [handlerName]: OpenAuthProvider } = await import(`./${p}OpenAuthProvider.js`);
      const provider = new OpenAuthProvider(app, openAuthSettings[p]);
      app.openAuthProviders[p] = provider;
    } catch (error) {
      console.error(`Open Auth provider ${handlerName} could not be loaded.`, error);
    }
  }
}
