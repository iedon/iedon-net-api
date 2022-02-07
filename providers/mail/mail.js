
module.exports = {
    mail: (app, mailSettings={}) => {
        app.mail = new (require(`./${mailSettings.provider || 'default'}MailProvider`))(app, mailSettings);
        return async (_, next) => await next();
    }
};
