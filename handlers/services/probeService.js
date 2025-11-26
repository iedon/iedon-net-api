import {
  PROBE_FAMILIES,
  PROBE_FAMILY_IPV4,
  PROBE_FAMILY_IPV6,
  buildProbeRedisKey,
} from "../../common/probe.js";

const DEFAULT_PROBE_TIMEOUT_SEC = 300;

export const getProbeSnapshots = async (c, sessionUuids = []) => {
  const result = new Map();
  if (!Array.isArray(sessionUuids) || sessionUuids.length === 0) {
    return result;
  }

  const app = c.var.app;
  const settings = app.settings.probeServerSettings;
  const redis = app.redis.getInstance();
  const uniqueUuids = Array.from(new Set(sessionUuids));

  for (const uuid of uniqueUuids) {
    result.set(uuid, createEmptyProbeSnapshot());
  }

  if (!settings.enabled || !redis || uniqueUuids.length === 0) {
    return result;
  }

  const keyTasks = [];
  uniqueUuids.forEach((uuid) => {
    if (uuid) for (const family of PROBE_FAMILIES) {
      keyTasks.push({ uuid, family, key: buildProbeRedisKey(uuid, family) });
    }
  });

  const rawResults = new Map();
  const BATCH_SIZE = 50;
  for (let i = 0; i < keyTasks.length; i += BATCH_SIZE) {
    const batch = keyTasks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map((task) => redis.get(task.key));
    const batchResponses = await Promise.allSettled(batchPromises);

    batchResponses.forEach((response, index) => {
      const task = batch[index];
      if (response.status === "fulfilled" && response.value) {
        rawResults.set(task.key, response.value);
      } else if (response.status === "rejected") {
        app.logger
          .getLogger("app")
          .error(`Failed to load probe data for ${task.key}: ${response.reason}`);
      }
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const timeout = Number(settings.sessionHealthyTimeoutSec) || DEFAULT_PROBE_TIMEOUT_SEC;

  keyTasks.forEach(({ uuid, family, key }) => {
    const snapshot = result.get(uuid);
    if (!snapshot) return;
    const rawValue = rawResults.get(key);
    if (!rawValue) return;
    const parsed = safeJsonParse(rawValue);
    if (!parsed) return;
    snapshot[family] = buildProbeFamilyState(parsed, now, timeout);
  });

  return result;
};

export const attachProbeSnapshots = async (c, collection, selector) => {
  if (!Array.isArray(collection) || collection.length === 0 || typeof selector !== "function") {
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
      item.probe = snapshot;
    }
  }
};

export const deleteProbeEntries = async (c, sessionUuid) => {
  if (!sessionUuid) return;
  const redis = c?.var?.app?.redis?.getInstance ? c.var.app.redis.getInstance() : null;
  if (!redis) {
    return;
  }
  try {
    await redis.del(
      buildProbeRedisKey(sessionUuid, PROBE_FAMILY_IPV4),
      buildProbeRedisKey(sessionUuid, PROBE_FAMILY_IPV6)
    );
  } catch (error) {
    c.var.app.logger
      .getLogger("app")
      .warn(`Failed to delete probe data for session ${sessionUuid}: ${error.message}`);
  }
};

function createEmptyProbeSnapshot() {
  return {
    [PROBE_FAMILY_IPV4]: createEmptyProbeFamilyState(),
    [PROBE_FAMILY_IPV6]: createEmptyProbeFamilyState(),
  };
}

function createEmptyProbeFamilyState() {
  return {
    seen: false,
    healthy: null,
    nat: null,
  };
}

function buildProbeFamilyState(record, now, timeout) {
  if (!record) {
    return createEmptyProbeFamilyState();
  }
  const timestamp = Number(record.timestamp) || 0;
  const healthy = timestamp > 0 ? now - timestamp <= timeout : false;
  return {
    seen: true,
    healthy,
    nat: Boolean(record.nat),
  };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
