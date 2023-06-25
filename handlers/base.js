import { makeResponse, RESPONSE_CODE } from "../common/packet.js";

export class BaseHandler {
    constructor(router) {
        this.router = router;
        this.makeResponse = makeResponse;
        this.RESPONSE_CODE = RESPONSE_CODE;
    }
}
