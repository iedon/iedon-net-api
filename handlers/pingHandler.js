const BaseHandler = require("./baseHandler");

/*
    "REQUEST": {
        "action": "ping"
    },

    "RESPSONE": "pong",

*/

module.exports = class PingHandler extends BaseHandler {

    constructor(router) {
        super(router);
        this.router.post('/ping', async (ctx, _) => await this.ping(ctx));
    }

    async ping(ctx) {
        if (ctx.request.body.action !== 'ping')
        {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, 'pong');
    }

}
