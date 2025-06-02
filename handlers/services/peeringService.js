import { makeResponse, RESPONSE_CODE } from "../../common/packet.js";
import {
  nullOrEmpty,
  IPV4_REGEX,
  IPV6_REGEX,
  ASN_MAX,
  ASN_MIN,
} from "../../common/helper.js";

// Routing Policy
// 0: full/transit(send and recv all valid)
// 1: peer(send own, recv their owned)
// 2: upstream(send all valid, recv their owned)
// 3: downstream(send own, recv all valid)
const ROUTING_POLICY = {
  FULL: 0,
  PEER: 1,
  UPSTREAM: 2,
  DOWNSTREAM: 3,
};
const AUTHORIZATION_HEADER = "Authorization";

async function getRouterCbParams(c, routerUuid, transaction = null) {
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

async function getBgpSession(c, uuid, transaction = null) {
  const options = {
    attributes: [
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
      return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
    }

    // Reject requests are not belonging to this user
    if (session.asn !== Number(c.var.state.asn)) {
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

    const response = await c.var.app.fetch.post(
      url,
      {
        action,
        session,
      },
      "json",
      {
        header: {
          [AUTHORIZATION_HEADER]: `Bearer ${agentSecret}`,
        },
      }
    );

    if (
      !response ||
      response.status !== 200 ||
      nullOrEmpty(response.data) ||
      !response.data.success
    ) {
      throw new Error(
        `Calling router's callback failed: ${
          response ? `HTTP Status ${response.status}` : "Null response"
        }`
      );
    }

    if (action === "delete") {
      const rows = await c.var.app.models.bgpSessions.destroy({
        where: { uuid: sessionUuid },
        transaction,
      });
      if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    } else {
      const rows = await c.var.app.models.bgpSessions.update(
        { status: action === "enable" || action === "approve" ? 1 : 0 },
        { where: { uuid: sessionUuid }, transaction }
      );
      if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    }

    await transaction.commit();
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
  if (!session) return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

  // Reject requests are not belonging to this user
  if (session.asn !== Number(c.var.state.asn))
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

  if (session.status < 1) return makeResponse(c, RESPONSE_CODE.OK, "");

  return makeResponse(
    c,
    RESPONSE_CODE.OK,
    await c.var.app.redis.getData(`session:${sessionUuid}`)
  );
}

export async function enumPeeringSessions(c, enumAll = false) {
  const sessions = [];
  try {
    const options = {
      attributes: [
        "uuid",
        "router",
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
    const summary = await c.var.app.redis.getData(`enum:${c.var.state.asn}`);
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
      if (summary) {
        const { state, info } = summary[result[i].dataValues.uuid];
        Object.assign(data, {
          summary: {
            state: state || "",
            info: info || "",
          },
        });
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

  const response = await c.var.app.fetch.post(
    url,
    {
      action: "info",
      asn: c.var.state.asn,
      data,
    },
    "json",
    {
      header: {
        [AUTHORIZATION_HEADER]: `Bearer ${agentSecret}`,
      },
    }
  );

  if (
    !response ||
    response.status !== 200 ||
    nullOrEmpty(response.data) ||
    !response.data.success
  )
    return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
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

export async function addPeeringSession(c) {
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

  if (
    nullOrEmpty(routerUuid) ||
    typeof routerUuid !== "string" ||
    (nullOrEmpty(_ipv4) &&
      nullOrEmpty(_ipv6) &&
      nullOrEmpty(_ipv6_link_local)) ||
    nullOrEmpty(_type) ||
    typeof _type !== "string" ||
    nullOrEmpty(_data) ||
    // Uncomment bellow to disallow empty endpoit/credential
    // nullOrEmpty(_endpoint) ||
    // nullOrEmpty(_credential)) ||
    !Array.isArray(_extensions) ||
    _extensions.some((e) => typeof e !== "string") ||
    nullOrEmpty(_mtu) ||
    nullOrEmpty(_policy)
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
    nullOrEmpty(_mtu) ||
    typeof _mtu !== "number" ||
    isNaN(_mtu) ||
    _mtu < 1280 ||
    _mtu > 9999 ||
    nullOrEmpty(_policy) ||
    typeof _policy !== "number" ||
    isNaN(_policy) ||
    !Object.values(ROUTING_POLICY).includes(_policy)
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

  if (!nullOrEmpty(_endpoint)) {
    try {
      if (_endpoint.indexOf(":") === -1) throw new Error("Invalid endpoint");
      const url = new URL(`https://${_endpoint}`);
      _endpoint = url.host;
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
      if (!typeExist || !extensionExist)
        throw new Error("Invalid link type or extension");
    } catch {
      // This also supresses JSON exception
      await transaction.rollback();
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    // Check whether the router is available to add a new session
    if (routerQuery && routerQuery.dataValues.session_capacity > 0) {
      const capacity = routerQuery.dataValues.session_capacity;
      const routerSessionCount = await c.var.app.models.bgpSessions.count({
        where: {
          router: routerUuid,
        },
        transaction,
      });

      // router is open and has enough capacity for new peerings
      if (capacity - routerSessionCount > 0) {
        const mySessionCount = await c.var.app.models.bgpSessions.count({
          where: {
            router: routerUuid,
            asn: Number(c.var.state.asn),
          },
          transaction,
        });

        if (mySessionCount > 0xff)
          throw new Error(
            `Too many sessions for peer "${c.var.state.asn}" on router "${routerUuid}"`
          );

        const peerAsn = isAdmin ? _asn : Number(c.var.state.asn);
        let ifname = `dn${peerAsn.toString(36)}${mySessionCount.toString(16)}`;

        // Check if the session with specific ifname already exists
        const checkIfNameExist = async (interfaceName) => {
          const ifNameCount = await c.var.app.models.bgpSessions.count({
            where: {
              router: routerUuid,
              asn: Number(c.var.state.asn),
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
            ifname = `dn${peerAsn.toString(36)}${(mySessionCount + 1).toString(
              16
            )}`;
          }

          // Something wrong
          if (await checkIfNameExist(ifname)) {
            throw new Error(
              `Interface name "${ifname}" already exists for peer "${peerAsn}" on router "${routerUuid}"`
            );
          }
        }

        await c.var.app.models.bgpSessions.create(
          {
            router: routerUuid,
            asn: peerAsn,
            status: routerQuery.dataValues.auto_peering ? 1 : -1,
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
          },
          { transaction }
        );

        if (routerQuery.dataValues.auto_peering) {
          const response = await c.var.app.fetch.post(
            url,
            {
              action: "add",
              router: routerUuid,
              asn: peerAsn,
              ipv4: _ipv4 || null,
              ipv6: _ipv6 || null,
              ipv6LinkLocal: _ipv6_link_local || null,
              type: _type,
              extensions: JSON.stringify(extensions),
              interface: ifname,
              endpoint: _endpoint || null,
              credential: _credential || null,
              data: _data,
              mtu: _mtu,
              policy: _policy,
            },
            "json",
            {
              header: {
                [AUTHORIZATION_HEADER]: `Bearer ${agentSecret}`,
              },
            }
          );

          if (
            !response ||
            response.status !== 200 ||
            nullOrEmpty(response.data) ||
            !response.data.success
          ) {
            throw new Error(
              `Calling router's callback failed: ${
                response ? `HTTP Status ${response.status}` : "Null response"
              }`
            );
          }
        }
      }
    }

    await transaction.commit();
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
    await transaction.rollback();
    return makeResponse(
      c,
      RESPONSE_CODE.ROUTER_NOT_AVAILABLE,
      error.toString()
    );
  }

  return makeResponse(c, RESPONSE_CODE.OK);
}
