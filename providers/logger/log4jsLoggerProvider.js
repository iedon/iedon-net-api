import { DefaultLoggerProvider } from './defaultLoggerProvider.js';
import log4js from 'log4js';

export class Log4jsLoggerProvider extends DefaultLoggerProvider {
    constructor(app, loggerSettings) {
        super(app, loggerSettings);
        log4js.configure(this.loggerSettings.log4js);
    }

    getLogger(loggerName) {
        return log4js.getLogger(loggerName);
    }
}
