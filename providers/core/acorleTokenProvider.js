const DefaultTokenProvider = require('./defaultTokenProvider')

module.exports = class AcorleTokenProvider extends DefaultTokenProvider {
    constructor(app, tokenSettings) {
        super(app, tokenSettings);
    }

    async generateToken(state) {
        try {
            return await this.app.acorle.requestPeerService(this.tokenSettings.acorle.serviceKey, {
                action: 'generate',
                state
            });
        } catch (error) {
            if (this.tokenSettings.logging) this.logger.error(error);
            return null;
        }
    }

    async verify(token) {
        try {
            return JSON.parse(await this.app.acorle.requestPeerService(this.tokenSettings.acorle.serviceKey, {
                action: 'verify',
                token
            }));
        } catch (error) {
            if (this.tokenSettings.logging) this.logger.error(error);
            return null;
        }
    }
}
