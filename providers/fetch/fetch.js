
module.exports = {
    fetch: (app, fetchSettings={}) => {
        app.fetch = new (require(`./${fetchSettings.provider || 'default'}FetchProvider`))(app, fetchSettings);
        return async (_, next) => await next();
    }
};
