import { BaseHandler } from "./base.js";
import { nullOrEmpty, bcryptGenSalt, bcryptGenHash } from "../common/helper.js";

export class SettingsHandler extends BaseHandler {

    constructor(app) {
        super(app);
        this.app.server.post('/settings', async c => {
            const action = c.var.body.action;
            switch (action) {
                case 'password': return await this.password(c);
                default: return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    async password(c) {
        let success = false;
        try {
            
            let password = null;
            if (!nullOrEmpty(c.var.body.password) && typeof c.var.body.password === 'string') {
                const salt = await bcryptGenSalt();
                password = await bcryptGenHash(c.var.body.password.trim(), salt);
            }

            // Try insert new record
            try {

                await c.var.models.peerPreferences.create({
                    asn: Number(c.var.state.asn),
                    password
                });
                success = true;

            } catch (error) {
                // record exists, update it
                if (error.name === 'SequelizeUniqueConstraintError') {
                    await c.var.models.peerPreferences.update({ password }, {
                        where: {
                            asn: Number(c.var.state.asn)
                        }
                    });
                    success = true;
                } else {
                    c.var.app.logger.getLogger('app').error(error);
                }
            }
            
        } catch (error) {
            c.var.app.logger.getLogger('app').error(error);
        }
        return this.makeResponse(c, this.RESPONSE_CODE.OK, { success });
    }

}
