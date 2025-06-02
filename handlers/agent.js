import { timingSafeEqual } from "crypto";
import { makeResponse, RESPONSE_CODE } from "../common/packet";

function verifyAgentToken(c) {
  const header = c.req.header("Authorization");
  if (!header) return false;

  const token = header.split("Bearer\x20")[1];
  if (!token) return false;

  const expected = Buffer.from(
    c.var.app.settings.authHandler.agentToken,
    "utf8"
  );
  const received = Buffer.from(token, "utf8");

  // Ensure both buffers are the same length for timingSafeEqual
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export default async function (c) {
  if (!verifyAgentToken(c)) {
    return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
  }

  const { action, router } = c.req.param();

  const count = await c.var.app.models.routers.count({
    where: {
      uuid: router,
    },
  });
  if (!count) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  switch (action) {
    case "report":
      return await report(c, router);
    case "heartbeat":
      return await heartbeat(c, router);
    case "getSessions":
      return await getSessions(c, router);
    default:
      return makeResponse(c, RESPONSE_CODE.NOT_FOUND);
  }
}

async function getSessions(c, router) {
  const sessions = [];
  try {
    const result = await c.var.app.models.bgpSessions.findAll({
      attributes: [
        "uuid",
        "status",
        "ipv4",
        "ipv6",
        "ipv6_link_local",
        "type",
        "extensions",
        "interface",
        "endpoint",
        "credential",
        "data",
        "mtu",
        "policy",
      ],
      where: {
        router,
      },
    });
    for (let i = 0; i < result.length; i++) {
      const data = {
        uuid: result[i].dataValues.uuid,
        router: result[i].dataValues.router,
        status: result[i].dataValues.status,
        ipv4: result[i].dataValues.ipv4,
        ipv6: result[i].dataValues.ipv6,
        ipv6LinkLocal: result[i].dataValues.ipv6_link_local,
        type: result[i].dataValues.type,
        extensions: result[i].dataValues.extensions
          ? JSON.parse(result[i].dataValues.extensions)
          : [],
        interface: result[i].dataValues.interface,
        endpoint: result[i].dataValues.endpoint,
        credential: result[i].dataValues.credential,
        data: result[i].dataValues.data
          ? JSON.parse(result[i].dataValues.data)
          : "",
        mtu: result[i].dataValues.mtu,
        policy: result[i].dataValues.policy,
      };
      sessions.push(data);
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK, { sessions });
}

async function heartbeat(c, router) {
  const { version, kernel, uptime, rs, tx, rx, tcp, udp } = c.var.body;
  if (
    await c.var.app.redis.setData(`router:${router}`, {
      version: version || "",
      kernel: kernel || "",
      uptime: uptime || 0,
      rs: rs || "",
      tx: tx || 0,
      rx: rx || 0,
      tcp: tcp || 0,
      udp: udp || 0,
    })
  )
    return makeResponse(c, RESPONSE_CODE.OK);
  else return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
}

async function report(c, router) {
  const { sessions } = c.var.body;
  if (!sessions || !Array.isArray(sessions)) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    // TODO
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}
