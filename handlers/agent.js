import { bcryptCompare } from "../common/helper";
import { makeResponse, RESPONSE_CODE } from "../common/packet";
import {
  deleteDbSession,
  modifyDbSessionStatus,
  PEERING_STATUS,
  requestAgentToSync,
  getRouterCbParams,
  getBgpSession,
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
  const sessionUuid = session;
  if (
    status === undefined ||
    status === null ||
    isNaN(status) ||
    !Object.values(PEERING_STATUS).includes(status) ||
    !sessionUuid
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  try {
    const currentSession = await getBgpSession(c, sessionUuid);
    if (!currentSession) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

    const [url, agentSecret] = await getRouterCbParams(
      c,
      currentSession.router
    );
    if (!url || !agentSecret) {
      return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
    }

    if (status === PEERING_STATUS.DELETED) {
      await deleteDbSession(c, sessionUuid);
      await c.var.app.redis.deleteData(`session:${sessionUuid}`);
    } else {
      await modifyDbSessionStatus(c, sessionUuid, status);
    }

    requestAgentToSync(c, url, agentSecret, currentSession.router).catch(
      (error) => {
        c.var.app.logger
          .getLogger("fetch")
          .error(`Failed to request agent to sync: ${error}`);
      }
    );
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK);
}

async function report(c) {
  const { metrics } = c.var.body;
  if (!metrics || !Array.isArray(metrics)) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  try {
    const enumMap = new Map();
    const redis = c.var.app.redis.getInstance();
    const multi = redis.multi({ pipeline: true });

    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i];
      if (!metric.uuid) continue;

      // Collect enum data for this ASN
      if (!enumMap.has(metric.asn)) enumMap.set(metric.asn, {});
      const asnPeers = enumMap.get(metric.asn);
      if (!asnPeers) continue;

      // Add session data to multi pipeline
      multi.set(
        `session:${metric.uuid}`,
        JSON.stringify({
          uuid: metric.uuid || "",
          asn: metric.asn || 0,
          timestamp: metric.timestamp || 0,
          bgp: metric.bgp?.map((entry) => {
            return {
              name: entry.name || "",
              state: entry.state || "",
              info: entry.info || "",
              type: entry.type || "",
              routes: {
                ipv4: {
                  imported: {
                    current: entry.routes?.ipv4?.imported?.current || 0,
                    metric: (entry.routes?.ipv4?.imported?.metric || []).map(
                      (m) => (m.length === 2 ? [m[0], m[1]] : [])
                    ),
                  },
                  exported: {
                    current: entry.routes?.ipv4?.exported?.current || 0,
                    metric: (entry.routes?.ipv4?.exported?.metric || []).map(
                      (m) => (m.length === 2 ? [m[0], m[1]] : [])
                    ),
                  },
                },
                ipv6: {
                  imported: {
                    current: entry.routes?.ipv6?.imported?.current || 0,
                    metric: (entry.routes?.ipv6?.imported?.metric || []).map(
                      (m) => (m.length === 2 ? [m[0], m[1]] : [])
                    ),
                  },
                  exported: {
                    current: entry.routes?.ipv6?.exported?.current || 0,
                    metric: (entry.routes?.ipv6?.exported?.metric || []).map(
                      (m) => (m.length === 2 ? [m[0], m[1]] : [])
                    ),
                  },
                },
              },
            };
          }),
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
        })
      );

      asnPeers[metric.uuid] =
        metric.bgp?.map((entry) => {
          return {
            name: entry.name || "",
            state: entry.state || "",
            info: entry.info || "",
          };
        }) || [];
    }

    // Execute session data updates first
    if (metrics.length) {
      // Execute all session metric updates in a single command
      const sessionResults = await multi.exec();
      for (let i = 0; i < sessionResults.length; i++) {
        const [err, result] = sessionResults[i];
        if (err || result !== "OK") {
          c.var.app.logger
            .getLogger("app")
            .error(
              `Error writing session data to redis: error: "${err}", result: "${result}"`
            );
        }
      }

      // Atomically update enum data for each ASN using defined command (batched concurrent)
      const BATCH_SIZE = 5; // Process 5 ASNs concurrently per batch
      const enumEntries = Array.from(enumMap.entries());
      const allEnumResults = [];

      for (let i = 0; i < enumEntries.length; i += BATCH_SIZE) {
        const batch = enumEntries.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(([asn, dict]) =>
          redis
            .mergeEnum(`enum:${asn}`, JSON.stringify(dict))
            .then(() => ({ status: "fulfilled", asn }))
            .catch((error) => ({ status: "rejected", asn, error }))
        );

        const batchResults = await Promise.allSettled(batchPromises);
        allEnumResults.push(...batchResults);
      }

      // Log any failures
      allEnumResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const asn = enumEntries[index][0];
          c.var.app.logger
            .getLogger("app")
            .error(`Error updating enum data for ASN ${asn}: ${result.reason}`);
        } else if (result.value.status === "rejected") {
          c.var.app.logger
            .getLogger("app")
            .error(
              `Error updating enum data for ASN ${result.value.asn}: ${result.value.error}`
            );
        }
      });
    }
  } catch (error) {
    c.var.app.logger
      .getLogger("app")
      .error(`Error executing Redis operations: ${error}`);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK);
}
