
module.exports = {
    whois: (app, whoisSettings={}) => {
        app.whois = new (require(`./${whoisSettings.provider || 'default'}WhoisProvider`))(app, whoisSettings);
        return async (_, next) => await next();
    }
};
