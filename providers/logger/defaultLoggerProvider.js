module.exports = class DefaultLoggerProvider {
    constructor(app, loggerSettings) {
        this.app = app;
        this.loggerSettings = loggerSettings;
        this.logger = {
            trace: log => console.trace(`[TRACE] ${log}`),
            debug: log => console.debug(`[DEBUG] ${log}`),
            info: log => console.info(`[INFO] ${log}`),
            warn: log => console.warn(`[WARN] ${log}`),
            error: log => console.error(`[ERROR] ${log}`),
            fatal: log => console.fatal(`[FATAL] ${log}`)
        };
    }
    getLogger(loggerName) {
        switch (loggerName) {
            default: return this.logger;
        }
    }
}
