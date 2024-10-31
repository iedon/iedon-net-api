import { makeResponse, RESPONSE_CODE } from "../common/packet.js";

export class BaseHandler {
  constructor(app) {
    this.app = app;
    this.makeResponse = makeResponse;
    this.RESPONSE_CODE = RESPONSE_CODE;
  }
}
