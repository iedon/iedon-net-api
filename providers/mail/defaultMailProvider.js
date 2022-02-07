module.exports = class DefaultMailProvider {
    constructor(app, mailSettings) {
        this.app = app;
        this.mailSettings = mailSettings;
        this.logger = this.app.logger.getLogger('mail');
    }
    async send(to, subject, content) {
        if (this.mailSettings.logging) this.logger.info(`[DefaultMailProvider] Mail provider is not configured. Suppressing mail to ${to}, subject: ${subject}, content: ${content}`)
        return true;
    }
}
