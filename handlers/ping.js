import { BaseHandler } from "./base.js";

/*
    "REQUEST": {
        "action": "ping"
    },

    "RESPSONE": "pong",

*/

export class PingHandler extends BaseHandler {

    constructor(app) {
        super(app);
        this.app.post('/ping', async c => await this.ping(c));
    }

    async ping(c) {
        const body = await c.req.json();
        if (!body || body.action !== 'ping')
        {
            return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
        }
        return this.makeResponse(c, this.RESPONSE_CODE.OK, 'pong');
    }

}
