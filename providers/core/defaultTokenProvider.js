const { signAsync, verifyAsync } = require("../../common/helper");

module.exports = class DefaultTokenProvider {
    constructor(app, tokenSettings) {
        this.app = app;
        this.tokenSettings = tokenSettings;
        this.logger = this.app.logger.getLogger('auth');
    }

    async generateToken(state) {
        try {
            return await signAsync(state, this.tokenSettings.jwt.secret, this.tokenSettings.jwt.options);
        } catch (error) {
            if (this.tokenSettings.logging) this.logger.error(error);
            return null;
        }
    }

    async verify(token) {
        try {
            return await verifyAsync(token, this.tokenSettings.jwt.secret, this.tokenSettings.jwt.options);
        } catch (error) {
            if (error.name !== 'TokenExpiredError') {
                if (this.tokenSettings.logging) this.logger.error(error);
            }
            return null;
        }
    }

}
