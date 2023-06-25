export async function useWhois(app, whoisSettings={}) {
    const pn = `${whoisSettings.provider || 'default'}WhoisProvider`;
    const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);
    app.whois = new (await import(`./${pn}.js`))[handlerName](app, whoisSettings);
};
