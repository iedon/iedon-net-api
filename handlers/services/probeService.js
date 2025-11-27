import {
  PROBE_FAMILIES,
  PROBE_FAMILY_IPV4,
  PROBE_FAMILY_IPV6,
  buildProbeRedisKey,
} from "../../common/probe.js";

const DEFAULT_PROBE_TIMEOUT_SEC = 300;
const BATCH_SIZE = 50;

// Health status enum
export const PROBE_HEALTH_STATUS = {
  HEALTHY: 0,
  UNHEALTHY: 1,
  NA: 2,
};

export const getProbeSnapshots = async (c, sessionUuids = []) => {
  const result = new Map();
  if (!Array.isArray(sessionUuids) || sessionUuids.length === 0) {
    return result;
  }

  const app = c.var.app;
  const settings = app.settings.probeServerSettings;
  const redis = app.redis;
  const uniqueUuids = Array.from(new Set(sessionUuids));

  for (const uuid of uniqueUuids) {
    result.set(uuid, createEmptyProbeSnapshot());
  }

  if (!settings.enabled || !redis || uniqueUuids.length === 0) {
    return result;
  }

  const keyTasks = [];
  uniqueUuids.forEach((uuid) => {
    if (uuid)
      for (const family of PROBE_FAMILIES) {
        keyTasks.push({ uuid, family, key: buildProbeRedisKey(uuid, family) });
      }
  });

  const rawResults = new Map();
  for (let i = 0; i < keyTasks.length; i += BATCH_SIZE) {
    const batch = keyTasks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map((task) => redis.getData(task.key));
    const batchResponses = await Promise.allSettled(batchPromises);

    batchResponses.forEach((response, index) => {
      const task = batch[index];
      if (response.status === "fulfilled" && response.value) {
        rawResults.set(task.key, response.value);
      } else if (response.status === "rejected") {
        app.logger
          .getLogger("app")
          .error(
            `Failed to load probe data for ${task.key}: ${response.reason}`
          );
      }
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const timeout =
    Number(settings.sessionHealthyTimeoutSec) || DEFAULT_PROBE_TIMEOUT_SEC;

  // Build probe family states in batches
  for (let i = 0; i < keyTasks.length; i += BATCH_SIZE) {
    const batch = keyTasks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async ({ uuid, family, key }) => {
      const snapshot = result.get(uuid);
      if (!snapshot) return { status: "skipped", uuid, reason: "no_snapshot" };
      try {
        snapshot[family] = await buildProbeFamilyState(
          rawResults.get(key),
          now,
          timeout,
          redis,
          uuid,
          family
        );
        return { status: "fulfilled", uuid, family };
      } catch (error) {
        return { status: "rejected", uuid, family, error };
      }
    });

    const batchResponses = await Promise.allSettled(batchPromises);

    batchResponses.forEach((response, index) => {
      const task = batch[index];
      if (response.status === "rejected") {
        app.logger
          .getLogger("app")
          .error(
            `Failed to build probe state for ${task.uuid}:${task.family}: ${response.reason}`
          );
      } else if (response.value?.status === "rejected") {
        app.logger
          .getLogger("app")
          .error(
            `Error building probe state for ${response.value.uuid}:${response.value.family}: ${response.value.error}`
          );
      }
    });
  }

  return result;
};

export const attachProbeSnapshots = async (c, collection, selector) => {
  if (
    !Array.isArray(collection) ||
    collection.length === 0 ||
    typeof selector !== "function"
  ) {
    return;
  }
  const uuids = collection
    .map((item) => selector(item))
    .filter((uuid) => typeof uuid === "string" && uuid.length > 0);
  if (!uuids.length) return;
  const probeMap = await getProbeSnapshots(c, uuids);
  for (const item of collection) {
    const uuid = selector(item);
    if (!uuid) continue;
    const snapshot = probeMap.get(uuid);
    if (snapshot) {
      item.probe = snapshot || createEmptyProbeSnapshot;
    }
  }
};

export const deleteProbeEntries = async (c, sessionUuid) => {
  const redis = c.var.app.redis;
  try {
    await Promise.all([
      redis.deleteData(buildProbeRedisKey(sessionUuid, PROBE_FAMILY_IPV4)),
      redis.deleteData(buildProbeRedisKey(sessionUuid, PROBE_FAMILY_IPV6)),
    ]);
  } catch (error) {
    c.var.app.logger
      .getLogger("app")
      .warn(
        `Failed to delete probe data for session ${sessionUuid}: ${error.message}`
      );
  }
};

export function createEmptyProbeSnapshot() {
  return {
    [PROBE_FAMILY_IPV4]: createEmptyProbeFamilyState(),
    [PROBE_FAMILY_IPV6]: createEmptyProbeFamilyState(),
  };
}

function createEmptyProbeFamilyState() {
  return {
    timestamp: null,
    status: PROBE_HEALTH_STATUS.NA,
    nat: null,
  };
}

async function buildProbeFamilyState(
  record,
  now,
  timeout,
  redis,
  sessionUuid,
  family
) {

  const timestamp = record ? (Number(record.timestamp) || 0) : 0;
  const isHealthyByTimestamp =
    timestamp > 0 ? now - timestamp <= timeout : false;

  let healthStatus = isHealthyByTimestamp
    ? PROBE_HEALTH_STATUS.HEALTHY
    : PROBE_HEALTH_STATUS.UNHEALTHY;

  // If unhealthy by timestamp, check BGP state from Redis
  if (!isHealthyByTimestamp) {
    try {
      const sessionKey = `session:${sessionUuid}`;
      const sessionData = await redis.getData(sessionKey);
      if (sessionData && Array.isArray(sessionData.bgp)) {
        // sessionData.bgp can be ipv4, ipv6, ipv4 & ipv6 or mpbgp
        // Determine which BGP types to check based on family
        // For ipv4: check "ipv4" or "mpbgp"
        // For ipv6: check "ipv6" or "mpbgp"
        // mpbgp is treated as both ipv4+ipv6
        const relevantBgpTypes =
          family === "ipv4" ? ["ipv4", "mpbgp"] : ["ipv6", "mpbgp"];

        // Check if any relevant BGP sessions exist and their state
        const relevantBgpSessions = sessionData.bgp.filter((bgp) =>
          relevantBgpTypes.includes(bgp.type)
        );

        // If we found relevant BGP sessions and ALL of them are down, mark as N/A
        if (relevantBgpSessions.length > 0) {
          const allDown = relevantBgpSessions.every(
            (bgp) =>
              bgp.state !== undefined &&
              bgp.state !== null &&
              typeof bgp.state === "string" &&
              bgp.state.toLowerCase() !== "up" &&
              bgp.state.toLowerCase() !== "established"
          );

          if (allDown) {
            healthStatus = PROBE_HEALTH_STATUS.NA;
          }
        } else {
          // No relevant BGP sessions found, mark as N/A
          // This can happen if the session has no BGP configured for this family(eg. single channel)
          healthStatus = PROBE_HEALTH_STATUS.NA;
        }
      }
    } catch {
      // If Redis fetch fails, keep the UNHEALTHY status
      // Don't log here to avoid spam, caller can handle logging if needed
    }
  }

  return {
    timestamp: timestamp > 0 ? timestamp : null,
    status: healthStatus,
    nat: Boolean(record && record.nat),
  };
}
