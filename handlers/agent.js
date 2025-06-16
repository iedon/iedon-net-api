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

  const maxRecordsToKeep =
    c.var.app.settings.metricSettings.maxRecordsToKeep || 288;
  const lockTimeout =
    c.var.app.settings.metricSettings.redisLockTimeoutMs || 10000; // 10 seconds

  try {
    const enumMap = new Map();
    const redis = c.var.app.redis.getInstance();

    // Filter out metrics without UUID
    const validMetrics = metrics.filter((metric) => metric.uuid);

    // Process metrics in batches using Promise.allSettled
    const BATCH_SIZE = 10; // Process 10 metrics concurrently per batch
    const allMetricResults = [];

    for (let i = 0; i < validMetrics.length; i += BATCH_SIZE) {
      const batch = validMetrics.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (metric) => {
        const lockKey = `lock:${metric.uuid}`;
        const sessionKey = `session:${metric.uuid}`;

        // Try to acquire lock with 10s timeout
        try {
          const lockAcquired = await redis.set(
            lockKey,
            "1",
            "PX",
            lockTimeout,
            "NX"
          );
          if (!lockAcquired) {
            c.var.app.logger
              .getLogger("app")
              .warn(
                `Failed to acquire lock for session ${metric.uuid}, skipping`
              );
            return {
              status: "skipped",
              uuid: metric.uuid,
              reason: "lock_failed",
            };
          }
        } catch (error) {
          c.var.app.logger
            .getLogger("app")
            .error(`Error acquiring lock for session ${metric.uuid}: ${error}`);
          return { status: "rejected", uuid: metric.uuid, error };
        }

        try {
          // Get existing data from Redis
          const existingData = await c.var.app.redis.getData(sessionKey);

          // Build new metric entry with current values only from client
          const newMetricData = {
            uuid: metric.uuid || "",
            asn: metric.asn || 0,
            timestamp: metric.timestamp || 0,
            bgp: metric.bgp?.map((entry) => {
              const existingBgp =
                existingData?.bgp?.find((e) => e.name === entry.name) || {};
              return {
                name: entry.name || "",
                state: entry.state || "",
                info: entry.info || "",
                type: entry.type || "",
                routes: {
                  ipv4: {
                    imported: {
                      current: entry.routes?.ipv4?.imported?.current || 0,
                      metric:
                        entry.type === "ipv6"
                          ? []
                          : appendToMetricArray(
                              maxRecordsToKeep,
                              existingBgp.routes?.ipv4?.imported?.metric || [],
                              metric.timestamp,
                              entry.routes?.ipv4?.imported?.current || 0
                            ),
                    },
                    exported: {
                      current: entry.routes?.ipv4?.exported?.current || 0,
                      metric:
                        entry.type === "ipv6"
                          ? []
                          : appendToMetricArray(
                              maxRecordsToKeep,
                              existingBgp.routes?.ipv4?.exported?.metric || [],
                              metric.timestamp,
                              entry.routes?.ipv4?.exported?.current || 0
                            ),
                    },
                  },
                  ipv6: {
                    imported: {
                      current: entry.routes?.ipv6?.imported?.current || 0,
                      metric:
                        entry.type === "ipv4"
                          ? []
                          : appendToMetricArray(
                              maxRecordsToKeep,
                              existingBgp.routes?.ipv6?.imported?.metric || [],
                              metric.timestamp,
                              entry.routes?.ipv6?.imported?.current || 0
                            ),
                    },
                    exported: {
                      current: entry.routes?.ipv6?.exported?.current || 0,
                      metric:
                        entry.type === "ipv4"
                          ? []
                          : appendToMetricArray(
                              maxRecordsToKeep,
                              existingBgp.routes?.ipv6?.exported?.metric || [],
                              metric.timestamp,
                              entry.routes?.ipv6?.exported?.current || 0
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
                metric: appendToTrafficMetricArray(
                  maxRecordsToKeep,
                  existingData?.interface?.traffic?.metric || [],
                  metric.timestamp,
                  metric.interface?.traffic?.current?.[0] || 0, // Tx
                  metric.interface?.traffic?.current?.[1] || 0 // Rx
                ),
              },
            },
            rtt: {
              current: metric.rtt?.current || 0,
              loss: metric.rtt?.loss || 0.0,
              metric: appendToMetricArray(
                maxRecordsToKeep,
                existingData?.rtt?.metric || [],
                metric.timestamp,
                metric.rtt?.current || 0
              ),
            },
          };

          // Save updated data back to Redis
          const success = await c.var.app.redis.setData(
            sessionKey,
            newMetricData
          );
          if (!success) {
            c.var.app.logger
              .getLogger("app")
              .error(`Failed to save session data for ${metric.uuid}`);
          }

          // Collect enum data for this ASN
          if (!enumMap.has(metric.asn)) enumMap.set(metric.asn, {});
          const asnPeers = enumMap.get(metric.asn);
          if (asnPeers) {
            asnPeers[metric.uuid] =
              metric.bgp?.map((entry) => {
                return {
                  name: entry.name || "",
                  state: entry.state || "",
                  info: entry.info || "",
                  type: entry.type || "",
                };
              }) || [];
          }

          return { status: "fulfilled", uuid: metric.uuid };
        } finally {
          // Always release the lock
          try {
            await redis.del(lockKey);
          } catch (err) {
            c.var.app.logger
              .getLogger("app")
              .error(`Error releasing lock for key ${lockKey}:`, err);
          }
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      allMetricResults.push(...batchResults);
    }

    // Log any failures
    allMetricResults.forEach((result, index) => {
      if (result.status === "rejected") {
        const metric = validMetrics[index];
        c.var.app.logger
          .getLogger("app")
          .error(
            `Error processing metric for UUID ${metric?.uuid}: ${result.reason}`
          );
      } else if (result.value.status === "rejected") {
        c.var.app.logger
          .getLogger("app")
          .error(
            `Error processing metric for UUID ${result.value.uuid}: ${result.value.error}`
          );
      } else if (result.value.status === "skipped") {
        c.var.app.logger
          .getLogger("app")
          .warn(
            `Skipped processing metric for UUID ${result.value.uuid}: ${result.value.reason}`
          );
      }
    });

    // Update enum data for each ASN using defined command (batched concurrent)
    if (enumMap.size > 0) {
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
      .error(`Error importing report metrics: ${error}`);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK);
}

// Helper function to append new metric data to existing metric array
function appendToMetricArray(
  maxRecordsToKeep,
  existingMetrics,
  timestamp,
  value
) {
  const newMetrics = [...existingMetrics];
  newMetrics.push([timestamp, value]);

  // Keep only last maxRecordsToKeep entries to prevent unlimited growth
  if (newMetrics.length > maxRecordsToKeep) {
    newMetrics.splice(0, newMetrics.length - maxRecordsToKeep);
  }

  return newMetrics;
}

// Helper function to append new traffic metric data to existing traffic metric array
function appendToTrafficMetricArray(
  maxRecordsToKeep,
  existingMetrics,
  timestamp,
  tx,
  rx
) {
  const newMetrics = [...existingMetrics];
  newMetrics.push([timestamp, tx, rx]);

  // Keep only last maxRecordsToKeep entries to prevent unlimited growth
  if (newMetrics.length > maxRecordsToKeep) {
    newMetrics.splice(0, newMetrics.length - maxRecordsToKeep);
  }

  return newMetrics;
}
