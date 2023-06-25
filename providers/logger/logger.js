export async function useLogger(app, loggerSettings={}) {
    const pn = `${loggerSettings.provider || 'default'}LoggerProvider`;
    const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);
    app.logger = new (await import(`./${pn}.js`))[handlerName](app, loggerSettings);
};
