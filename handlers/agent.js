import { bcryptCompare } from "../common/helper";
import { makeResponse, RESPONSE_CODE } from "../common/packet";
import {
  deleteDbSession,
  modifyDbSessionStatus,
  PEERING_STATUS,
} from "./services/peeringService";

async function verifyAgentApiKey(c, router) {
  const header = c.req.header("Authorization");
  if (!header) return false;

  const token = header.split("Bearer\x20")[1];
  if (!token) return false;

  try {
    return await bcryptCompare(
      `${c.var.app.settings.authHandler.agentApiKey}${router}`,
      token
    );
  } catch {
    return false;
  }
}

export default async function (c) {
  const { action, router } = c.req.param();

  if (!(await verifyAgentApiKey(c, router || ""))) {
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
  const { version, kernel, loadAvg, uptime, rs, tx, rx, tcp, udp, timestamp } =
    c.var.body;
  return makeResponse(
    c,
    (await c.var.app.redis.setData(`router:${router}`, {
      version: version || "",
      kernel: kernel || "",
      loadAvg: loadAvg || "",
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
  const { metrics } = c.var.body;
  if (!metrics || !Array.isArray(metrics)) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  const enumMap = new Map();
  const multi = c.var.app.redis.getInstance().multi({ pipeline: true });
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];
    if (!metric.uuid) continue;

    if (!enumMap.has(metric.asn)) enumMap.set(metric.asn, {});
    const asnPeers = enumMap.get(metric.asn);
    if (!asnPeers) continue;

    multi.set(`session:${metric.uuid}`, {
      uuid: metric.uuid || "",
      asn: metric.asn || 0,
      timestamp: metric.timestamp || 0,
      bgp: {
        state: metric.bgp?.state || "",
        info: metric.bgp?.info || "",
        routes: {
          ipv4: {
            imported: {
              current: metric.bgp?.routes?.ipv4?.imported?.current || 0,
              metric: (metric.bgp?.routes?.ipv4?.imported?.metric || []).map(
                (m) => (m.length === 2 ? [m[0], m[1]] : [])
              ),
            },
            exported: {
              current: metric.bgp?.routes?.ipv4?.exported?.current || 0,
              metric: (metric.bgp?.routes?.ipv4?.exported?.metric || []).map(
                (m) => (m.length === 2 ? [m[0], m[1]] : [])
              ),
            },
          },
          ipv6: {
            imported: {
              current: metric.bgp?.routes?.ipv6?.imported?.current || 0,
              metric: (metric.bgp?.routes?.ipv6?.imported?.metric || []).map(
                (m) => (m.length === 2 ? [m[0], m[1]] : [])
              ),
            },
            exported: {
              current: metric.bgp?.routes?.ipv6?.exported?.current || 0,
              metric: (metric.bgp?.routes?.ipv6?.exported?.metric || []).map(
                (m) => (m.length === 2 ? [m[0], m[1]] : [])
              ),
            },
          },
        },
      },
      interface: {
        ipv4: metric.interface?.ipv4 || "",
        ipv6: metric.interface?.ipv6 || "",
        ipv6LinkLocal: metric.interface?.ipv6LinkLocal || "",
        mac: metric.interface?.mac || "",
        mtu: metric.interface?.mtu || 0,
        status: metric.interface?.status || "",
        traffic: {
          total: [
            metric.interface?.traffic?.total?.[0] || 0, // Tx
            metric.interface?.traffic?.total?.[1] || 0, // Rx
          ],
          current: [
            metric.interface?.traffic?.current?.[0] || 0, // Tx
            metric.interface?.traffic?.current?.[1] || 0, // Rx
          ],
          metric: (metric.interface?.traffic?.metric || []).map((m) =>
            m.length === 3 ? [m[0], m[1], m[2]] : []
          ),
        },
      },
      rtt: {
        current: metric.rtt?.current || 0,
        metric: (metric.rtt?.metric || []).map((m) =>
          m.length === 2 ? [m[0], m[1]] : []
        ),
      },
    });

    asnPeers[metric.uuid] = {
      state: metric.bgp?.state || "",
      info: metric.bgp?.info || "",
    };
  }

  if (metrics.length) {
    for (const [asn, dict] of enumMap.entries()) {
      multi.set(`enum:${asn}`, dict);
    }

    try {
      const results = await multi.exec();
      for (let i = 0; i < results.length; i++) {
        const { err, result } = results[i];
        if (err || result !== "OK") {
          c.var.app.logger
            .getLogger("app")
            .error(`Error writing metric data to redis: ${err || result}`);
        }
      }
    } catch (error) {
      c.var.app.logger
        .getLogger("app")
        .error(`Error executing Redis batch: ${error}`);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}
