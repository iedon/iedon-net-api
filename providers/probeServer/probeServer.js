import dgram from "dgram";
import crypto from "crypto";
import { PROBE_PACKET_HEADER, PROBE_PACKET_FOOTER, PROBE_FAMILY_IPV4, PROBE_FAMILY_IPV6, buildProbeRedisKey } from "../../common/probe.js";

const AUTH_TAG_LENGTH = 16;
const MIN_NONCE_LENGTH = 1;
const MAX_NONCE_LENGTH = 128;
const ZERO_IPV4 = Buffer.alloc(4, 0);
const ZERO_IPV6 = Buffer.alloc(16, 0);

export async function useProbeServer(app, probeSettings = {}) {
  if (!probeSettings?.enabled) {
    return;
  }

  if (!app?.redis || typeof app.redis.setData !== "function") {
    app.logger
      .getLogger("app")
      .warn("[ProbeServer] Redis context missing, skipping probe server initialization");
    return;
  }

  const settings = probeSettings;
  if (!settings.encryptionKey) {
    app.logger
      .getLogger("app")
      .warn("[ProbeServer] encryptionKey missing, probe server disabled");
    return;
  }

  if (!settings.bindUdpPort) {
    app.logger
      .getLogger("app")
      .warn("[ProbeServer] Invalid UDP port configuration, probe server disabled");
    return;
  }

  if (!settings.bindAddress4 && !settings.bindAddress6) {
    app.logger
      .getLogger("app")
      .warn("[ProbeServer] No bind addresses configured, probe server disabled");
    return;
  }

  let derivedKey;
  try {
    derivedKey = deriveAES256Key(settings.encryptionKey);
  } catch (error) {
    app.logger
      .getLogger("app")
      .error(`[ProbeServer] Failed to derive encryption key: ${error.message}`);
    return;
  }

  const server = new ProbeServer(app, settings, derivedKey);
  await server.start();
  app.probeServer = server;
}

class ProbeServer {
  constructor(app, settings, encryptionKey) {
    this.app = app;
    this.settings = settings;
    this.encryptionKey = encryptionKey;
    this.logger = app.logger.getLogger("app");
    this.redis = app.redis;
    this.sockets = [];
  }

  async start() {
    const bindingTasks = [];
    if (this.settings.bindAddress4) {
      bindingTasks.push(this.bindSocket("udp4", this.settings.bindAddress4));
    }
    if (this.settings.bindAddress6) {
      bindingTasks.push(this.bindSocket("udp6", this.settings.bindAddress6));
    }
    try {
      await Promise.all(bindingTasks);
    } catch (error) {
      this.logger.error(`[ProbeServer] Failed to bind UDP sockets: ${error.message}`);
    }

    if (this.sockets.length === 0) {
      this.logger.warn("[ProbeServer] No UDP sockets active; probe server not running");
    }
  }

  async bindSocket(type, address) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type, reuseAddr: true });
      const bindErrorHandler = (err) => {
        socket.close();
        reject(err);
      };

      socket.once("error", bindErrorHandler);
      socket.bind(this.settings.bindUdpPort, address, () => {
        socket.removeListener("error", bindErrorHandler);
        socket.on("error", (err) => {
          this.logger.error(
            `[ProbeServer] ${type.toUpperCase()} socket error on ${address}:${this.settings.bindUdpPort}: ${err.message}`
          );
        });
        socket.on("message", (msg, rinfo) => this.handlePacket(msg, rinfo));
        this.sockets.push(socket);
        this.logger.info(
          `[ProbeServer] ${type.toUpperCase()} listening on ${address}:${this.settings.bindUdpPort}`
        );
        resolve();
      });
    });
  }

  handlePacket(message, rinfo) {
    if (!validateLength(message.length, this.settings.maxPacketLength)) {
      return;
    }

    const parsedPacket = this.parsePacket(message);
    if (!parsedPacket) {
      return;
    }

    if (!this.isTimestampValid(parsedPacket.timestamp)) {
      return;
    }

    const familyKey = rinfo.family === "IPv6" ? PROBE_FAMILY_IPV6 : PROBE_FAMILY_IPV4;
    const remoteAddress = familyKey === PROBE_FAMILY_IPV6 ? normalizeIPv6(rinfo.address) : rinfo.address;
    const expectedAddress =
      familyKey === PROBE_FAMILY_IPV6 ? parsedPacket.srcIPv6 : parsedPacket.srcIPv4;
    const nat = expectedAddress ? remoteAddress !== expectedAddress : false;

    const record = {
      uuid: parsedPacket.sessionUuid,
      asn: parsedPacket.asn,
      timestamp: parsedPacket.timestamp,
      router: parsedPacket.routerUuid,
      nat,
    };

    const targetKey = buildProbeRedisKey(parsedPacket.sessionUuid, familyKey);
    this.redis
      .setData(targetKey, record)
      .then((ok) => {
        if (!ok) {
          this.logger.warn(
            `[ProbeServer] Failed to persist probe data for session ${parsedPacket.sessionUuid}`
          );
        }
      })
      .catch((error) => {
        this.logger.error(`[ProbeServer] Redis error while persisting probe data: ${error.message}`);
      });
  }

  parsePacket(message) {
    if (
      message.length < PROBE_PACKET_HEADER.length + PROBE_PACKET_FOOTER.length + 2 ||
      message[0] !== PROBE_PACKET_HEADER[0] ||
      message[1] !== PROBE_PACKET_HEADER[1] ||
      message[2] !== PROBE_PACKET_HEADER[2]
    ) {
      return null;
    }

    const totalLength = message.readUInt16LE(3);
    if (totalLength !== message.length) {
      return null;
    }

    const footerOffset = message.length - PROBE_PACKET_FOOTER.length;
    if (
      message[footerOffset] !== PROBE_PACKET_FOOTER[0] ||
      message[footerOffset + 1] !== PROBE_PACKET_FOOTER[1]
    ) {
      return null;
    }

    const bannerStart = PROBE_PACKET_HEADER.length + 2;
    const bannerEnd = message.indexOf(0x00, bannerStart);
    if (bannerEnd === -1 || bannerEnd >= footerOffset) {
      return null;
    }

    const banner = message.toString("utf8", bannerStart, bannerEnd);
    if (banner !== this.settings.expectedBanner) {
      return null;
    }

    const nonceSizeFieldStart = bannerEnd + 1;
    const nonceSizeFieldEnd = nonceSizeFieldStart + 4;
    if (nonceSizeFieldEnd > footerOffset) {
      return null;
    }
    const nonceSize = message.readUInt32LE(nonceSizeFieldStart);
    if (
      !Number.isFinite(nonceSize) ||
      nonceSize < MIN_NONCE_LENGTH ||
      nonceSize > MAX_NONCE_LENGTH
    ) {
      return null;
    }

    const nonceStart = nonceSizeFieldEnd;
    const nonceEnd = nonceStart + nonceSize;
    if (nonceEnd > footerOffset) {
      return null;
    }

    const nonce = message.subarray(nonceStart, nonceEnd);
    if (nonce.length !== nonceSize) {
      return null;
    }

    const encrypted = message.subarray(nonceEnd, footerOffset);
    if (encrypted.length <= AUTH_TAG_LENGTH) {
      return null;
    }

    const payload = decryptPayload(this.encryptionKey, nonce, encrypted);
    if (!payload) {
      return null;
    }

    return parsePayloadBuffer(payload);
  }

  isTimestampValid(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return false;
    }
    return Math.abs(now - timestamp) <= this.settings.timestampToleranceSec;
  }
}

function validateLength(length, maxLength) {
  return length > 0 && length <= maxLength;
}

function decryptPayload(key, nonce, payload) {
  try {
    const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(0, payload.length - AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

function parsePayloadBuffer(payload) {
  let offset = 0;
  if (!payload || payload.length < 8 + 1 + 1 + 4 + 4 + 16) {
    return null;
  }

  const timestamp = Number(payload.readBigUInt64LE(offset));
  offset += 8;

  const routerEnd = payload.indexOf(0x00, offset);
  if (routerEnd === -1) {
    return null;
  }
  const routerUuid = payload.toString("utf8", offset, routerEnd);
  offset = routerEnd + 1;

  const sessionEnd = payload.indexOf(0x00, offset);
  if (sessionEnd === -1) {
    return null;
  }
  const sessionUuid = payload.toString("utf8", offset, sessionEnd);
  offset = sessionEnd + 1;

  if (payload.length < offset + 4 + 4 + 16) {
    return null;
  }

  const asn = payload.readUInt32LE(offset);
  offset += 4;
  const srcIPv4 = decodeIPv4LittleEndian(payload.subarray(offset, offset + 4));
  offset += 4;
  const srcIPv6 = decodeIPv6LittleEndian(payload.subarray(offset, offset + 16));

  if (!routerUuid || !sessionUuid) {
    return null;
  }

  return {
    timestamp,
    routerUuid,
    sessionUuid,
    asn,
    srcIPv4,
    srcIPv6,
  };
}

function decodeIPv4LittleEndian(buf) {
  if (!buf || buf.length !== 4 || buf.equals(ZERO_IPV4)) {
    return null;
  }
  const networkOrder = Buffer.alloc(4);
  const value = buf.readUInt32LE(0);
  networkOrder.writeUInt32BE(value, 0);
  return `${networkOrder[0]}.${networkOrder[1]}.${networkOrder[2]}.${networkOrder[3]}`;
}

function decodeIPv6LittleEndian(buf) {
  if (!buf || buf.length !== 16 || buf.equals(ZERO_IPV6)) {
    return null;
  }
  const networkOrder = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    networkOrder[i] = buf[15 - i];
  }
  return formatIPv6(networkOrder);
}

function formatIPv6(buffer) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) {
    parts.push(buffer.readUInt16BE(i).toString(16).padStart(4, "0"));
  }
  return parts.join(":");
}

function normalizeIPv6(address) {
  if (!address) return "";
  const percentIndex = address.indexOf("%");
  const raw = percentIndex === -1 ? address : address.slice(0, percentIndex);
  const buffer = ipv6StringToBuffer(raw);
  if (!buffer) {
    return raw.toLowerCase();
  }
  return formatIPv6(buffer);
}

function ipv6StringToBuffer(address) {
  const parts = address.split("::");
  if (parts.length > 2) {
    return null;
  }

  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];

  if (tail.length && tail[tail.length - 1].includes(".")) {
    const ipv4Text = tail.pop();
    const ipv4Buffer = ipv4StringToBuffer(ipv4Text);
    if (!ipv4Buffer) {
      return null;
    }
    tail.push(((ipv4Buffer[0] << 8) | ipv4Buffer[1]).toString(16));
    tail.push(((ipv4Buffer[2] << 8) | ipv4Buffer[3]).toString(16));
  }

  const missing = 8 - (head.length + tail.length);
  if (missing < 0) {
    return null;
  }

  const segments = [...head, ...new Array(missing).fill("0"), ...tail];
  const buffer = Buffer.alloc(16);
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] || "0";
    const value = parseInt(segment, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) {
      return null;
    }
    buffer.writeUInt16BE(value, i * 2);
  }
  return buffer;
}

function ipv4StringToBuffer(address) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const buffer = Buffer.alloc(4);
  for (let i = 0; i < 4; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    buffer[i] = value;
  }
  return buffer;
}

function deriveAES256Key(input) {
  const value = `${input || ""}`.trim();
  if (!value) {
    throw new Error("Empty encryption key");
  }

  const candidates = [
    () => decodeBase64(value, false),
    () => decodeBase64(value, true),
    () => decodeHex(value),
    () => useRaw(value),
  ];

  for (const candidate of candidates) {
    const key = candidate();
    if (key && key.length === 32) {
      return key;
    }
  }

  return crypto.createHash("sha256").update(value).digest();
}

function decodeBase64(value, noPadding) {
  try {
    let normalized = value;
    if (noPadding && value.length % 4 !== 0) {
      normalized = value.padEnd(value.length + (4 - (value.length % 4)), "=");
    }
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

function decodeHex(value) {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (normalized.length !== 64) {
    return null;
  }
  try {
    return Buffer.from(normalized, "hex");
  } catch {
    return null;
  }
}

function useRaw(value) {
  if (value.length !== 32) {
    return null;
  }
  return Buffer.from(value, "utf8");
}
