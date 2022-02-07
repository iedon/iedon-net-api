
module.exports = {
    logger: (app, loggerSettings={}) => {
        app.logger = new (require(`./${loggerSettings.provider || 'default'}LoggerProvider`))(app, loggerSettings);
        return async (_, next) => await next();
    }
};
