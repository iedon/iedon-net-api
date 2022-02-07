const DefaultLoggerProvider = require('./defaultLoggerProvider')
const log4js = require('log4js');

module.exports = class Log4jsLoggerProvider extends DefaultLoggerProvider {
    constructor(app, loggerSettings) {
        super(app, loggerSettings);
        log4js.configure(this.loggerSettings.log4js);
    }

    getLogger(loggerName) {
        return log4js.getLogger(loggerName);
    }
}
