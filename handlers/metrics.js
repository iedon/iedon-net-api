import { makeResponse, RESPONSE_CODE } from "../common/packet.js";

const METRIC_DEFINITIONS = [
  {
    name: "peerapi_agent_report_timestamp_seconds",
    type: "gauge",
    help: "Timestamp of the latest metrics report received from the agent.",
  },
  {
    name: "peerapi_interface_mtu_bytes",
    type: "gauge",
    help: "Interface MTU in bytes per BGP session.",
  },
  {
    name: "peerapi_interface_status",
    type: "gauge",
    help: "Interface operational status (1 for up, 0 otherwise).",
  },
  {
    name: "peerapi_interface_traffic_bytes",
    type: "gauge",
    help: "Interface traffic volume grouped by kind (total/current) and direction (tx/rx).",
  },
  {
    name: "peerapi_session_rtt_ms",
    type: "gauge",
    help: "Latest recorded round-trip time in milliseconds for a session.",
  },
  {
    name: "peerapi_session_rtt_loss_percent",
    type: "gauge",
    help: "Latest recorded packet loss percentage for a session.",
  },
  {
    name: "peerapi_bgp_session_state",
    type: "gauge",
    help: "Numeric BGP session state (up=5,down=4,start=3,stop=2,flush=1,other=0).",
  },
  {
    name: "peerapi_bgp_routes_current_total",
    type: "gauge",
    help: "Current BGP route counters grouped by direction and address family.",
  },
];

const BGP_STATE_VALUES = [
  { key: "up", value: 5 },
  { key: "down", value: 4 },
  { key: "start", value: 3 },
  { key: "stop", value: 2 },
  { key: "flush", value: 1 },
  { key: "other", value: 0 },
];

const askForBasicAuth = (c) => {
  c.header("WWW-Authenticate", 'Basic realm="Access Restricted"');
  return makeResponse(c, RESPONSE_CODE.UNAUTHORIZED);
};

const basicAuth = async (c) => {
  const app = c.var.app;
  try {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic\x20")) {
      return false;
    }
    const base64Credentials = authHeader.slice("Basic\x20".length).trim();
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf-8"
    );
    const separatorIndex = credentials.indexOf(":");
    if (separatorIndex === -1) return false;

    const username = credentials.slice(0, separatorIndex);
    const password = credentials.slice(separatorIndex + 1);
    const allowedUsers =
      app.settings.metricSettings.exporter.allowedBasicAuthUsers || [];
    let isAuthorized = false;

    for (const user of allowedUsers) {
      if (
        typeof user?.username !== "string" ||
        typeof user?.password !== "string"
      ) {
        continue;
      }

      if (user.username === username && user.password === password) {
        isAuthorized = true;
        break;
      }
    }

    return isAuthorized;
  } catch {
    return false;
  }
};

export default async function metricsHandler(c) {
  const app = c.var.app;
  const redis = app.redis.getInstance();

  if (!(await basicAuth(c))) {
    return askForBasicAuth(c);
  }

  try {
    const sessionKeys = await collectSessionKeys(c, redis);
    if (sessionKeys.length === 0) {
      return respondWithMetrics(c, []);
    }

    const sessions = [];
    const BATCH_SIZE = 50;
    for (let i = 0; i < sessionKeys.length; i += BATCH_SIZE) {
      const batchKeys = sessionKeys.slice(i, i + BATCH_SIZE);
      const batchPromises = batchKeys.map((key) =>
        c.var.app.redis.getData(key)
      );
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          const value = result.value;
          if (value && typeof value === "object") {
            sessions.push(value);
          }
        } else {
          app.logger
            ?.getLogger("app")
            .warn(
              `Failed to load session metrics for key ${batchKeys[index]}: ${result.reason}`
            );
        }
      });
    }

    return respondWithMetrics(c, sessions);
  } catch (error) {
    app.logger
      ?.getLogger("app")
      .error(`Failed to collect Prometheus metrics: ${error}`);
    return makeResponse(
      c,
      RESPONSE_CODE.SERVER_ERROR,
      "Failed to collect metrics"
    );
  }
}

async function collectSessionKeys(c, redis) {
  const keys = [];
  let cursor = "0";
  const prefix = typeof redis.options?.keyPrefix === "string" ? redis.options.keyPrefix : "";

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}session:*`,
      "COUNT",
      c.var.app.settings.metricSettings.exporter.scannerBatchSize || 200
    );
    if (Array.isArray(batch)) {
      for (const key of batch) {
        if (typeof key !== "string") continue;
        keys.push(prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key);
      }
    }

    cursor = nextCursor;
  } while (cursor !== "0");

  return keys;
}

function respondWithMetrics(c, sessions) {
  const lines = [];

  for (const definition of METRIC_DEFINITIONS) {
    lines.push(`# HELP ${definition.name} ${definition.help}`);
    lines.push(`# TYPE ${definition.name} ${definition.type}`);
  }

  sessions.forEach((session) => {
    const baseLabels = {
      session_uuid: sanitizeLabelValue(session?.uuid || ""),
      router: sanitizeLabelValue(session?.router || "unknown"),
      asn: sanitizeLabelValue(String(session?.asn ?? "0")),
    };

    addTimestampMetric(lines, baseLabels, session?.timestamp);
    addInterfaceMetrics(lines, baseLabels, session?.interface);
    addRttMetrics(lines, baseLabels, session?.rtt);
    addBgpMetrics(lines, baseLabels, session?.bgp);
  });

  const payload = `${lines.join("\n")}\n`;
  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.body(payload);
}

function addTimestampMetric(lines, baseLabels, timestamp) {
  if (!Number.isFinite(Number(timestamp))) return;
  const ts = normalizeTimestamp(Number(timestamp));
  pushSample(lines, "peerapi_agent_report_timestamp_seconds", baseLabels, ts);
}

function addInterfaceMetrics(lines, baseLabels, iface) {
  if (!iface || typeof iface !== "object") return;

  const mtu = Number(iface.mtu);
  if (Number.isFinite(mtu)) {
    pushSample(lines, "peerapi_interface_mtu_bytes", baseLabels, mtu);
  }

  if (typeof iface.status === "string") {
    const statusLabels = {
      ...baseLabels,
      status: sanitizeLabelValue(iface.status.toLowerCase()),
    };
    const isUp = iface.status.toLowerCase() === "up" ? 1 : 0;
    pushSample(lines, "peerapi_interface_status", statusLabels, isUp);
  }

  const traffic = iface.traffic || {};
  addTrafficMetric(lines, baseLabels, "total", traffic.total);
  addTrafficMetric(lines, baseLabels, "current", traffic.current);
}

function addTrafficMetric(lines, baseLabels, kind, values) {
  if (!Array.isArray(values)) return;

  const tx = Number(values[0]);
  const rx = Number(values[1]);

  if (Number.isFinite(tx)) {
    const txLabels = {
      ...baseLabels,
      kind,
      direction: "tx",
    };
    pushSample(lines, "peerapi_interface_traffic_bytes", txLabels, tx);
  }

  if (Number.isFinite(rx)) {
    const rxLabels = {
      ...baseLabels,
      kind,
      direction: "rx",
    };
    pushSample(lines, "peerapi_interface_traffic_bytes", rxLabels, rx);
  }
}

function addRttMetrics(lines, baseLabels, rtt) {
  if (!rtt || typeof rtt !== "object") return;

  const current = Number(rtt.current);
  if (Number.isFinite(current)) {
    pushSample(lines, "peerapi_session_rtt_ms", baseLabels, current);
  }

  const loss = Number(rtt.loss);
  if (Number.isFinite(loss)) {
    pushSample(lines, "peerapi_session_rtt_loss_percent", baseLabels, loss);
  }
}

function addBgpMetrics(lines, baseLabels, bgpEntries) {
  if (!Array.isArray(bgpEntries)) return;

  bgpEntries.forEach((entry) => {
    const peerName = sanitizeLabelValue(entry?.name || "unknown");
    const family = sanitizeLabelValue((entry?.type || "unknown").toLowerCase());
    const stateLabel = sanitizeLabelValue(entry?.state || "unknown");

    const peerLabels = {
      ...baseLabels,
      peer_name: peerName,
      family,
      state: stateLabel,
    };

    const stateValue = mapBgpState(entry?.state);
    pushSample(lines, "peerapi_bgp_session_state", peerLabels, stateValue);

    const families = [
      ["ipv4", entry?.routes?.ipv4],
      ["ipv6", entry?.routes?.ipv6],
    ];

    families.forEach(([familyKey, routes]) => {
      if (!routes || typeof routes !== "object") return;

      const routeLabels = {
        ...baseLabels,
        peer_name: peerName,
        family: familyKey,
      };

      const imported = Number(routes.imported?.current);
      if (Number.isFinite(imported)) {
        pushSample(
          lines,
          "peerapi_bgp_routes_current_total",
          { ...routeLabels, direction: "imported" },
          imported
        );
      }

      const exported = Number(routes.exported?.current);
      if (Number.isFinite(exported)) {
        pushSample(
          lines,
          "peerapi_bgp_routes_current_total",
          { ...routeLabels, direction: "exported" },
          exported
        );
      }
    });
  });
}

function pushSample(lines, name, labels, value) {
  if (!Number.isFinite(value)) return;

  const labelEntries = Object.entries(labels).filter(
    ([, v]) => v !== undefined && v !== null
  );
  const labelString = labelEntries.length
    ? `{${labelEntries
        .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
        .join(",")}}`
    : "";

  lines.push(`${name}${labelString} ${value}`);
}

function sanitizeLabelValue(value) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }
  const trimmed = value.trim();
  return trimmed === "" ? "unknown" : trimmed;
}

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function normalizeTimestamp(timestamp) {
  if (timestamp > 1e12) {
    return Math.floor(timestamp / 1000);
  }
  return timestamp;
}

function mapBgpState(state) {
  if (typeof state !== "string") return -1;
  const normalized = state.toLowerCase().replace(/[^a-z]/g, "");
  for (const entry of BGP_STATE_VALUES) {
    if (normalized.includes(entry.key)) {
      return entry.value;
    }
  }
  return -1;
}
