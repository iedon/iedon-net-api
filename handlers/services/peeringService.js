import { makeResponse, RESPONSE_CODE } from "../../common/packet.js";
import {
  nullOrEmpty,
  IPV4_REGEX,
  IPV6_REGEX,
  ASN_MAX,
  ASN_MIN,
  bcryptGenHash,
  bcryptGenSalt,
} from "../../common/helper.js";

// Routing Policy
// FULL 0:
//  Send all valid routes.  Receive all valid routes.
//  Send received routes to:
//  - Full-table peers
//  - Downstream peer

// TRANSIT 1:
//  Send our valid self and downstream routes. Receive all valid routes.
//  Send received routes to:
//  - Full-table peers
//  - Downstream peers

// PEER 2:
//  Send our valid self and downstream routes. Receive remote owned valid and remtoe downstream routes.
//  Send received routes to:
//  - Full-table peers
//  - Downstream peers

// DOWNSTREAM 3:
//  Send all valid routes. Receive remote owned valid and remote downstream routes.
//  Send received routes to:
//  - Full-table peers
//  - Transit peers
//  - Downstream peers

// UPSTREAM 4: (admin)
//  receive all valid routes
//  send self routes and downstream routes to remote
const ROUTING_POLICY = {
  FULL: 0,
  TRANSIT: 1,
  PEER: 2,
  DOWNSTREAM: 3,
  UPSTREAM: 4,
};

// Peering Session Status
export const PEERING_STATUS = {
  DELETED: 0, // Used for Agent Callback, not used in DB
  DISABLED: 1,
  ENABLED: 2,
  PENDING_APPROVAL: 3,
  QUEUED_FOR_SETUP: 4,
  QUEUED_FOR_DELETE: 5,
  PROBLEM: 6,
  TEARDOWN: 7,
};

const AUTHORIZATION_HEADER = "Authorization";

export async function getRouterCbParams(c, routerUuid, transaction = null) {
  const options = {
    attributes: ["agent_secret", "callback_url"],
    where: {
      uuid: routerUuid,
      public: true,
    },
  };
  if (transaction !== null) Object.assign(options, { transaction });
  const result = await c.var.app.models.routers.findOne(options);
  return result
    ? [result.dataValues.callback_url, result.dataValues.agent_secret]
    : [null, null];
}

export async function getBgpSession(c, uuid, transaction = null) {
  const options = {
    attributes: [
      "router",
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
      uuid,
    },
  };
  if (transaction !== null) Object.assign(options, { transaction });
  const result = await c.var.app.models.bgpSessions.findOne(options);
  return result
    ? {
        router: result.dataValues.router,
        asn: result.dataValues.asn,
        status: result.dataValues.status,
        ipv4: result.dataValues.ipv4,
        ipv6: result.dataValues.ipv6,
        ipv6LinkLocal: result.dataValues.ipv6_link_local,
        type: result.dataValues.type,
        extensions: result.dataValues.extensions
          ? JSON.parse(result.dataValues.extensions)
          : [],
        interface: result.dataValues.interface,
        endpoint: result.dataValues.endpoint,
        credential: result.dataValues.credential,
        data: result.dataValues.data ? JSON.parse(result.dataValues.data) : "",
        mtu: result.dataValues.mtu,
        policy: result.dataValues.policy,
      }
    : null;
}

function canSessionBeModified(status) {
  return ![
    PEERING_STATUS.DELETED, // never
    PEERING_STATUS.PENDING_APPROVAL,
    PEERING_STATUS.QUEUED_FOR_DELETE,
    PEERING_STATUS.QUEUED_FOR_SETUP,
    PEERING_STATUS.TEARDOWN,
  ].includes(status);
}

export async function generalAgentHandler(c, action) {
  const sessionUuid = c.var.body.session;
  const routerUuid = c.var.body.router;

  if (
    nullOrEmpty(sessionUuid) ||
    typeof sessionUuid !== "string" ||
    nullOrEmpty(routerUuid) ||
    typeof routerUuid !== "string"
  )
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

  const transaction = await c.var.app.sequelize.transaction();
  try {
    const session = await getBgpSession(c, sessionUuid, transaction);
    if (!session) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.NOT_FOUND);
    }

    // Reject requests are not belonging to this user
    if (session.asn !== Number(c.var.state.asn) && !(await isUserAdmin(c))) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    // Peering session is locked and user is not admin
    if (
      !canSessionBeModified(session.status) &&
      action !== "delete" &&
      !(await isUserAdmin(c))
    ) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    const [url, agentSecret] = await getRouterCbParams(
      c,
      routerUuid,
      transaction
    );
    if (!url || !agentSecret) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
    }

    let newStatus = PEERING_STATUS.DISABLED;
    switch (action) {
      case "enable":
        newStatus = PEERING_STATUS.ENABLED;
        break;
      case "approve":
        newStatus = PEERING_STATUS.QUEUED_FOR_SETUP;
        break;
      case "teardown":
        newStatus = PEERING_STATUS.TEARDOWN;
        break;
      case "delete":
        newStatus = PEERING_STATUS.QUEUED_FOR_DELETE;
        break;
      case "disable":
        newStatus = PEERING_STATUS.DISABLED;
        break;
      default:
        await transaction.rollback();
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }
    const rows = await c.var.app.models.bgpSessions.update(
      {
        status: newStatus,
      },
      { where: { uuid: sessionUuid }, transaction }
    );
    if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);

    await transaction.commit();
    requestAgentToSync(c, url, agentSecret, routerUuid).catch((error) => {
      c.var.app.logger
        .getLogger("fetch")
        .error(`Failed to request agent to sync: ${error}`);
    });
  } catch (error) {
    await transaction.rollback();
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}

export async function queryPeeringSession(c) {
  const sessionUuid = c.var.body.session;
  if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== "string")
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

  const session = await getBgpSession(c, sessionUuid);
  if (!session) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  // Reject requests are not belonging to this user
  if (!(await isUserAdmin(c)) && session.asn !== Number(c.var.state.asn))
    return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  let data = await c.var.app.redis.getData(`session:${sessionUuid}`);
  if (!data) {
    data = {};
  }

  data.data = session.data || "";

  return makeResponse(c, RESPONSE_CODE.OK, data);
}

export async function enumPeeringSessions(c, enumAll = false) {
  const sessions = [];
  try {
    const options = {
      attributes: [
        "uuid",
        "router",
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
    };
    if (!enumAll) {
      options.where = {
        asn: Number(c.var.state.asn),
      };
    }
    const result = await c.var.app.models.bgpSessions.findAll(options);
    const enumCache = new Map();
    for (let i = 0; i < result.length; i++) {
      const data = {
        uuid: result[i].dataValues.uuid,
        router: result[i].dataValues.router,
        asn: result[i].dataValues.asn,
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
      let hasCache = enumCache.has(data.asn);
      const summary = hasCache
        ? enumCache.get(data.asn)
        : await c.var.app.redis.getData(`enum:${data.asn}`);
      if (summary) {
        if (!hasCache) enumCache.set(data.asn, summary);
        const summaryArr = summary[result[i].dataValues.uuid];
        if (summaryArr && Array.isArray(summaryArr)) {
          const bgpStatus = summaryArr.map((s) => {
            return {
              name: s.name || "",
              state: s.state || "",
              info: s.info || "",
              type: s.type || "",
            };
          });
          Object.assign(data, {
            bgpStatus,
          });
        }
      }
      sessions.push(data);
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
  }
  return makeResponse(c, RESPONSE_CODE.OK, { sessions });
}

export async function nodeInfo(c) {
  const data = c.var.body.data || "";
  const routerUuid = c.var.body.router;

  if (nullOrEmpty(routerUuid) || typeof routerUuid !== "string")
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

  const [url, agentSecret] = await getRouterCbParams(c, routerUuid);
  if (!url || !agentSecret)
    return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

  const salt = await bcryptGenSalt();
  const token = await bcryptGenHash(`${agentSecret}${routerUuid}`, salt);
  const response = await c.var.app.fetch.post(
    `${url}/info`,
    {
      asn: Number(c.var.state.asn),
      data,
    },
    "json",
    {
      headers: {
        [AUTHORIZATION_HEADER]: `Bearer ${token}`,
      },
    }
  );

  if (
    !response ||
    response.status !== 200 ||
    nullOrEmpty(response.data) ||
    response.data.code !== 0
  ) {
    c.var.app.logger
      .getLogger("fetch")
      .error(
        `Calling router's callback failed: ${
          response
            ? `HTTP Status ${response.status}, Code: ${
                response.data.code || "None"
              }${
                response.data.message
                  ? `, Message: ${response.data.message}`
                  : ""
              }`
            : "Null response"
        }`
      );
    return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
  }
  return makeResponse(c, RESPONSE_CODE.OK, response.data.data);
}

export async function isUserAdmin(c) {
  try {
    const netAsn =
      (
        await c.var.app.models.settings.findOne({
          attributes: ["value"],
          where: { key: "NET_ASN" },
        })
      ).dataValues.value || "";
    return netAsn === c.var.state.asn;
  } catch (error) {
    c.var.app.logger.getLogger("auth").error(error);
    return false;
  }
}

export async function setPeeringSession(c, modify = false) {
  const routerUuid = c.var.body.router;
  const _ipv4 = c.var.body.ipv4;
  const _ipv6 = c.var.body.ipv6;
  const _ipv6_link_local = c.var.body.ipv6LinkLocal;
  const _type = c.var.body.type;
  const _extensions = c.var.body.extensions;
  let _endpoint = c.var.body.endpoint;
  const _credential = c.var.body.credential;
  const _data = c.var.body.data;
  const _mtu = c.var.body.mtu;
  const _policy = c.var.body.policy;
  const _sessionUuid = c.var.body.session;

  if (
    nullOrEmpty(routerUuid) ||
    typeof routerUuid !== "string" ||
    (nullOrEmpty(_ipv4) &&
      nullOrEmpty(_ipv6) &&
      nullOrEmpty(_ipv6_link_local)) ||
    nullOrEmpty(_type) ||
    typeof _type !== "string" ||
    nullOrEmpty(_data) ||
    !Array.isArray(_extensions) ||
    _extensions.some((e) => typeof e !== "string") ||
    (modify && nullOrEmpty(_sessionUuid))
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  let isAdmin = false;
  try {
    isAdmin = await isUserAdmin(c);
  } catch {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  const _asn = c.var.body.asn;
  if (
    isAdmin &&
    (nullOrEmpty(_asn) ||
      typeof _asn !== "number" ||
      isNaN(_asn) ||
      _asn < ASN_MIN ||
      _asn > ASN_MAX)
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  if (
    nullOrEmpty(_policy) ||
    typeof _policy !== "number" ||
    isNaN(_policy) ||
    !Object.values(ROUTING_POLICY).includes(_policy) ||
    (!isAdmin && _policy === ROUTING_POLICY.UPSTREAM)
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  if (
    nullOrEmpty(_mtu) ||
    typeof _mtu !== "number" ||
    isNaN(_mtu) ||
    _mtu < 1280 ||
    _mtu > 9999
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  if (
    (!nullOrEmpty(_ipv4) && typeof _ipv4 !== "string") ||
    (!nullOrEmpty(_ipv6) && typeof _ipv6 !== "string") ||
    (!nullOrEmpty(_ipv6_link_local) && typeof _ipv6_link_local !== "string") ||
    (!nullOrEmpty(_ipv4) && !IPV4_REGEX.test(_ipv4)) ||
    (!nullOrEmpty(_ipv6) && !IPV6_REGEX.test(_ipv6)) ||
    (!nullOrEmpty(_ipv6_link_local) && !IPV6_REGEX.test(_ipv6_link_local)) ||
    (!nullOrEmpty(_endpoint) && typeof _endpoint !== "string") ||
    (!nullOrEmpty(_credential) && typeof _credential !== "string")
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  if (
    nullOrEmpty(_credential) &&
    _type !== "gre" &&
    _type !== "ip6gre" &&
    _type !== "direct"
  ) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  if (!nullOrEmpty(_endpoint)) {
    try {
      if (
        _endpoint.indexOf(":") === -1 &&
        _type !== "gre" &&
        _type !== "ip6gre" &&
        _type !== "direct"
      )
        throw new Error("Invalid endpoint");
      if (_type === "gre") {
        if (!IPV4_REGEX.test(_endpoint)) throw new Error("Invalid endpoint");
      } else if (_type === "ip6gre") {
        if (!IPV6_REGEX.test(_endpoint)) throw new Error("Invalid endpoint");
      } else if (_type === "direct") {
        if (!IPV4_REGEX.test(_endpoint) && !IPV6_REGEX.test(_endpoint))
          throw new Error("Invalid endpoint");
      } else {
        const url = new URL(`https://${_endpoint}`);
        _endpoint = url.host;
      }
    } catch {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }
  }

  const transaction = await c.var.app.sequelize.transaction();
  try {
    const [url, agentSecret] = await getRouterCbParams(
      c,
      routerUuid,
      transaction
    );
    if (!url || !agentSecret) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
    }

    const routerQuery = await c.var.app.models.routers.findOne({
      attributes: [
        "auto_peering",
        "session_capacity",
        "ipv4",
        "ipv6",
        "ipv6_link_local",
        "link_types",
        "extensions",
      ],
      where: {
        uuid: routerUuid,
        public: true,
        open_peering: true,
      },
      transaction,
    });

    if (!routerQuery) {
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
    }

    let extensions = [];
    try {
      extensions = _extensions;
      const typeExist = JSON.parse(routerQuery.dataValues.link_types).some(
        (type) => type === _type
      );
      const extensionExist =
        extensions.length === 0 ||
        extensions.some((_e) =>
          JSON.parse(routerQuery.dataValues.extensions).some((e) => e === _e)
        );
      if (!typeExist || !extensionExist) {
        await transaction.rollback();
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
      }
    } catch {
      // This also supresses JSON exception
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    // Check whether the router is available to add a new session or modify existing one
    if (
      routerQuery &&
      (modify || routerQuery.dataValues.session_capacity > 0)
    ) {
      const capacity = routerQuery.dataValues.session_capacity;
      const routerSessionCount = await c.var.app.models.bgpSessions.count({
        where: {
          router: routerUuid,
        },
        transaction,
      });

      // router is open and has enough capacity for new peerings or modify existing one
      if (modify || capacity - routerSessionCount > 0) {
        let ifname = "";
        let session = null;
        const peerAsn = isAdmin ? _asn : Number(c.var.state.asn);
        if (modify) {
          session = await getBgpSession(c, _sessionUuid, transaction);
          if (!session) {
            await transaction.rollback();
            return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
          }
          if (!canSessionBeModified(session.status)) {
            await transaction.rollback();
            return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
          }
          ifname = session.interface;
        } else {
          const mySessionCount = await c.var.app.models.bgpSessions.count({
            where: {
              router: routerUuid,
              asn: peerAsn,
            },
            transaction,
          });

          if (mySessionCount > 0xff) {
            await transaction.rollback();
            return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
          }

          ifname = `dn${peerAsn.toString(36)}${mySessionCount.toString(16)}`;

          // Check if the session with specific ifname already exists
          const checkIfNameExist = async (interfaceName) => {
            const ifNameCount = await c.var.app.models.bgpSessions.count({
              where: {
                router: routerUuid,
                asn: peerAsn,
                interface: interfaceName,
              },
              transaction,
            });
            return ifNameCount !== 0;
          };

          // Already taken
          if (await checkIfNameExist(ifname)) {
            // try - 1
            ifname = `dn${peerAsn.toString(36)}${(mySessionCount - 1).toString(
              16
            )}`;

            // try + 1
            if (await checkIfNameExist(ifname)) {
              ifname = `dn${peerAsn.toString(36)}${(
                mySessionCount + 1
              ).toString(16)}`;
            }

            // Something wrong
            if (await checkIfNameExist(ifname)) {
              await transaction.rollback();
              return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }
          }
        }

        const options = {
          router: routerUuid,
          asn: peerAsn,
          status: routerQuery.dataValues.auto_peering
            ? PEERING_STATUS.QUEUED_FOR_SETUP
            : PEERING_STATUS.PENDING_APPROVAL,
          ipv4: _ipv4 || null,
          ipv6: _ipv6 || null,
          ipv6LinkLocal: _ipv6_link_local || null,
          type: _type,
          extensions: JSON.stringify(extensions),
          interface: ifname,
          endpoint: _endpoint || null,
          credential: _credential || null,
          data: JSON.stringify(_data),
          mtu: _mtu,
          policy: _policy,
        };
        if (modify && _sessionUuid) {
          await c.var.app.models.bgpSessions.update(
            options,
            { where: { uuid: _sessionUuid } },
            { transaction }
          );
        } else {
          await c.var.app.models.bgpSessions.create(options, { transaction });
        }
      }
    }

    await transaction.commit();
    if (routerQuery.dataValues.auto_peering) {
      requestAgentToSync(c, url, agentSecret, routerUuid).catch((error) => {
        c.var.app.logger
          .getLogger("fetch")
          .error(`Failed to request agent to sync: ${error}`);
      });
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    await transaction.rollback();
    return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}

export async function getPeeringSession(c) {
  const sessionUuid = c.var.body.session;
  if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== "string")
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

  const session = await getBgpSession(c, sessionUuid);
  if (!session) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  // Reject requests are not belonging to this user
  if (!(await isUserAdmin(c)) && session.asn !== Number(c.var.state.asn))
    return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  return makeResponse(c, RESPONSE_CODE.OK, { session });
}

export async function deleteDbSession(c, sessionUuid) {
  const rows = await c.var.app.models.bgpSessions.destroy({
    where: { uuid: sessionUuid },
  });
  if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
}

export async function modifyDbSessionStatus(c, sessionUuid, status) {
  const rows = await c.var.app.models.bgpSessions.update(
    { status },
    { where: { uuid: sessionUuid } }
  );
  if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
}

export async function requestAgentToSync(c, url, agentSecret, routerUuid) {
  const salt = await bcryptGenSalt();
  const token = await bcryptGenHash(`${agentSecret}${routerUuid}`, salt);
  const response = await c.var.app.fetch.get(`${url}/sync`, "json", {
    headers: {
      [AUTHORIZATION_HEADER]: `Bearer ${token}`,
    },
  });

  if (
    !response ||
    response.status !== 200 ||
    nullOrEmpty(response.data) ||
    response.data.code !== 0
  ) {
    c.var.app.logger
      .getLogger("fetch")
      .error(
        `Calling router's callback failed: ${
          response
            ? `HTTP Status ${response.status}, Code: ${
                response.data.code || "None"
              }${
                response.data.message
                  ? `, Message: ${response.data.message}`
                  : ""
              }`
            : "Null response"
        }`
      );
  }
}
