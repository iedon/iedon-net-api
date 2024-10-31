export async function useRouter(app, handlers) {
  app.routeHandlers = {};

  const handlerPromises = handlers
    .filter(h => h !== 'base')
    .map(async h => {
      const handlerName = `${h.charAt(0).toUpperCase()}${h.slice(1)}Handler`;
      const module = await import(`./handlers/${h}.js`);
      return [handlerName, new module[handlerName](app)];
    });

  const hp = await Promise.all(handlerPromises);
  hp.forEach(([name, instance]) => {
    app.routeHandlers[name] = instance;
  });
}