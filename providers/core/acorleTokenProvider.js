import { DefaultTokenProvider } from './defaultTokenProvider';

export default class AcorleTokenProvider extends DefaultTokenProvider {
    constructor(app, tokenSettings) {
        super(app, tokenSettings);
    }

    async generateToken(state) {
        try {
            return JSON.parse(await this.app.acorle.requestPeerService(this.tokenSettings.acorle.serviceKey, JSON.stringify({
                action: 'generate',
                state
            }), 'POST', { 'Content-Type': 'application/json' }));
        } catch (error) {
            if (this.tokenSettings.logging) this.logger.error(error);
            return null;
        }
    }

    async verify(token) {
        try {
            return JSON.parse(await this.app.acorle.requestPeerService(this.tokenSettings.acorle.serviceKey, JSON.stringify({
                action: 'verify',
                token
            }), 'POST', { 'Content-Type': 'application/json' }));
        } catch (error) {
            if (this.tokenSettings.logging) this.logger.error(error);
            return null;
        }
    }
}
