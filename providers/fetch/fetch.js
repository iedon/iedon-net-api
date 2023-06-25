export async function useFetch(app, fetchSettings={}) {
    const pn = `${fetchSettings.provider || 'default'}FetchProvider`;
    const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);
    app.fetch = new (await import(`./${pn}.js`))[handlerName](app, fetchSettings);
};
