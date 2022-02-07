const BaseHandler = require("./baseHandler");
const { nullOrEmpty, bcryptGenSalt, bcryptGenHash } = require("../common/helper");

module.exports = class SettingsHandler extends BaseHandler {

    constructor(router) {
        super(router);
        this.router.post('/settings', async (ctx, _) => {
            const action = ctx.request.body.action;
            switch (action) {
                case 'password': return await this.password(ctx);
                default: return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    async password(ctx) {
        let success = false;
        try {
            
            let password = null;
            if (!nullOrEmpty(ctx.request.body.password) && typeof ctx.request.body.password === 'string') {
                const salt = await bcryptGenSalt();
                password = await bcryptGenHash(ctx.request.body.password.trim(), salt);
            }

            // Try insert new record
            try {

                await ctx.models.peerPreferences.create({
                    asn: Number(ctx.state.asn),
                    password
                });
                success = true;

            } catch (error) {
                // record exists, update it
                if (error.name === 'SequelizeUniqueConstraintError') {
                    await ctx.models.peerPreferences.update({ password }, {
                        where: {
                            asn: Number(ctx.state.asn)
                        }
                    });
                    success = true;
                } else {
                    ctx.app.logger.getLogger('app').error(error);
                }
            }
            
        } catch (error) {
            ctx.app.logger.getLogger('app').error(error);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, { success });
    }

}
