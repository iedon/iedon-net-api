import { makeResponse, RESPONSE_CODE } from "../common/packet.js";
import {
  setPeeringSession,
  nodeInfo,
  queryPeeringSession,
  enumPeeringSessions,
  generalAgentHandler,
} from "./services/peeringService.js";

/*
    "REQUEST": {
        "action": "add" | "delete" | "up" | "down" | "info",
    },

    "RESPSONE": { // if type === routers
        "routers": [
            {
                "uuid": "1a2b3c4d5e6f1a2b3c4d5e6f",
                "name": "JP-TYO",
                "description": "Tokyo, Japan",
                "location": "JP",
                "openPeering": true,
                "sessionCapacity": 30,
                "sessionCount": 1
            },
            // ...
        ]
    },

*/

export default async function (c) {
  const action = c.var.body.action;
  if (action === "enum") return await enumPeeringSessions(c);

  switch (action) {
    case "add":
      return await setPeeringSession(c);
    case "modify":
      return await setPeeringSession(c, true);
    case "delete":
      return await generalAgentHandler(c, "delete");
    case "enable":
      return await generalAgentHandler(c, "enable");
    case "disable":
      return await generalAgentHandler(c, "disable");
    case "query":
      return await queryPeeringSession(c);
    case "info":
      return await nodeInfo(c); // get node peering info(string defined in agent config)
    default:
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }
}
