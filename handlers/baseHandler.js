const { makeResponse, RESPONSE_CODE } = require("../common/packet");

module.exports = class BaseHandler {
    constructor(router) {
        this.router = router;
        this.makeResponse = makeResponse;
        this.RESPONSE_CODE = RESPONSE_CODE;
    }
}
