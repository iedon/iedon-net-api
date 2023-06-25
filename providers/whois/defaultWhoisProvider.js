import whois from 'whois-json';

export class DefaultWhoisProvider {
    constructor(app, whoisSettings) {
        this.app = app;
        this.whoisSettings = whoisSettings;
        this.logger = this.app.logger.getLogger('whois');
    }

    async lookup(domainName) {
        try {
            return await whois(domainName, this.whoisSettings.whois);
        } catch (error) {
            if (this.whoisSettings.logging) this.logger.error(error);
            return null;
        }
    }
}
