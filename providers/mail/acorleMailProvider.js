const DefaultMailProvider = require('./defaultMailProvider')

module.exports = class AcorleMailProvider extends DefaultMailProvider {
    async send(to, subject, content) {
        try {
            const result = JSON.parse(await this.app.acorle.requestPeerService(this.mailSettings.acorle.serviceKey, {
                from: this.mailSettings.senderEmailAddress,
                to,
                subject,
                content
            }));
            if (!result || result.code !== 0) {
                if (this.mailSettings.logging) this.logger.error(`Failed to send mail to ${to}, subject: ${subject}, invalid rpc response.`);
                return false;
            }
            return true;
        } catch (error) {
            if (this.mailSettings.logging) this.logger.error(error);
            return false;
        }
    }
}
