import { nullOrEmpty } from "../common/helper.js";
import { makeResponse, RESPONSE_CODE } from "../common/packet.js";

/*
    "REQUEST": <GET>,

    "RESPSONE": {
      "token": "string"
    },

*/

export default async function (c) {
  if (nullOrEmpty(c.var.state) || nullOrEmpty(c.var.state.asn)) {
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }

  const nextToken = await c.var.app.token.generateToken({
    asn: c.var.state.asn
  });

  if (!nextToken) {
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }

  return makeResponse(c, RESPONSE_CODE.OK, { token: nextToken });
}
