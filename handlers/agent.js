import { bcryptCompare } from "../common/helper";
import { makeResponse, RESPONSE_CODE } from "../common/packet";
import {
  deleteDbSession,
  modifyDbSessionStatus,
  PEERING_STATUS,
} from "./services/peeringService";

async function verifyAgentToken(c, router) {
  const header = c.req.header("Authorization");
  if (!header) return false;

  const token = header.split("Bearer\x20")[1];
  if (!token) return false;

  try {
    return await bcryptCompare(`${c.var.app.settings.authHandler.agentToken}${router}`, token);
  } catch {
    return false;
  }
}

export default async function (c) {
  const { action, router } = c.req.param();

  if (!await verifyAgentToken(c, router || "")) {
    return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
  }

  const count = await c.var.app.models.routers.count({
    where: {
      uuid: router,
    },
  });
  if (!count) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  switch (action) {
    case "report":
      return await report(c);
    case "heartbeat":
      return await heartbeat(c, router);
    case "sessions":
      return await sessions(c, router);
    case "modify":
      return await modify(c);
    default:
      return makeResponse(c, RESPONSE_CODE.NOT_FOUND);
  }
}

async function sessions(c, router) {
  const bgpSessions = [];
  try {
    const result = await c.var.app.models.bgpSessions.findAll({
      attributes: [
        "uuid",
        "asn",
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
        asn: result[i].dataValues.asn,
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
      bgpSessions.push(data);
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK, { bgpSessions });
}

async function heartbeat(c, router) {
  const { version, kernel, uptime, rs, tx, rx, tcp, udp, timestamp } =
    c.var.body;
  return makeResponse(
    c,
    (await c.var.app.redis.setData(`router:${router}`, {
      version: version || "",
      kernel: kernel || "",
      uptime: uptime || 0,
      rs: rs || "",
      tx: tx || 0,
      rx: rx || 0,
      tcp: tcp || 0,
      udp: udp || 0,
      timestamp: timestamp || 0,
    }))
      ? RESPONSE_CODE.OK
      : RESPONSE_CODE.SERVER_ERROR
  );
}

async function modify(c) {
  const { status, session } = c.var.body;
  if (
    status === undefined ||
    status === null ||
    isNaN(status) ||
    !Object.values(PEERING_STATUS).includes(status) ||
    !session
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  try {
    if (status === PEERING_STATUS.DELETED) {
      await deleteDbSession(c, session);
      await c.var.app.redis.deleteData(`session:${session}`);
    } else {
      await modifyDbSessionStatus(c, session, status);
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
}

async function report(c) {
  const { sessions } = c.var.body;
  if (!sessions || !Array.isArray(sessions)) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  const enumMap = new Map();
  const multi = c.var.app.redis.getInstance().multi({ pipeline: true });
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    if (!session.uuid) continue;

    if (!enumMap.has(session.asn)) enumMap.set(session.asn, {});
    const asnPeers = enumMap.get(session.asn);
    if (!asnPeers) continue;

    multi.set(`session:${session.uuid}`, {
      uuid: session.uuid || "",
      asn: session.asn || 0,
      timestamp: session.timestamp || 0,
      bgp: {
        state: session.bgp.state || "",
        info: session.bgp.info || "",
        routes: {
          ipv4: {
            imported: {
              current: session.bgp.routes?.ipv4?.imported?.current || 0,
              metric: session.bgp.routes?.ipv4?.imported?.metric?.map((m) =>
                m.length === 2 ? [m[0], m[1]] : []
              ),
            },
            exported: {
              current: session.bgp.routes?.ipv4?.exported?.current || 0,
              metric: session.bgp.routes?.ipv4?.exported?.metric?.map((m) =>
                m.length === 2 ? [m[0], m[1]] : []
              ),
            },
          },
          ipv6: {
            imported: {
              current: session.bgp.routes?.ipv6?.imported?.current || 0,
              metric: session.bgp.routes?.ipv6?.imported?.metric?.map((m) =>
                m.length === 2 ? [m[0], m[1]] : []
              ),
            },
            exported: {
              current: session.bgp.routes?.ipv6?.exported?.current || 0,
              metric: session.bgp.routes?.ipv6?.exported?.metric?.map((m) =>
                m.length === 2 ? [m[0], m[1]] : []
              ),
            },
          },
        },
      },
      interface: {
        ipv4: session.interface?.ipv4 || "",
        ipv6: session.interface?.ipv6 || "",
        ipv6LinkLocal: session.interface?.ipv6LinkLocal || "",
        mac: session.interface?.mac || "",
        mtu: session.interface?.mtu || 0,
        status: session.interface?.status || "",
        traffic: {
          rx: {
            total: session.interface?.traffic?.rx?.total || 0,
            current: session.interface?.traffic?.rx?.current || 0,
            metric: session.interface?.traffic?.rx?.metric?.map((m) =>
              m.length === 2 ? [m[0], m[1]] : []
            ),
          },
          tx: {
            total: session.interface?.traffic?.tx?.total || 0,
            current: session.interface?.traffic?.tx?.current || 0,
            metric: session.interface?.traffic?.tx?.metric?.map((m) =>
              m.length === 2 ? [m[0], m[1]] : []
            ),
          },
        },
      },
      rtt: {
        current: session.rtt || 0,
        metric: session.rtt?.metric?.map((m) =>
          m.length === 2 ? [m[0], m[1]] : []
        ),
      },
    });

    asnPeers[session.uuid] = {
      state: session.bgp.state || "",
      info: session.bgp.info || "",
    };
  }

  if (sessions.length) {
    for (const [asn, dict] of enumMap.entries()) {
      await multi.set(`enum:${asn}`, dict);
    }

    const results = await multi.exec();
    results.forEach(({ err, result }) => {
      if (err || result !== "OK") {
        c.var.app.logger
          .getLogger("app")
          .error(`Error writing session data to redis: ${err || result}`);
      }
    });
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}
