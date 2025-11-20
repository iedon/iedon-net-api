import { makeResponse, RESPONSE_CODE } from "../common/packet.js";
import { nullOrEmpty, ASN_MIN, ASN_MAX } from "../common/helper.js";
import {
  enumPeeringSessions,
  queryPeeringSession,
  generalAgentHandler,
  isUserAdmin,
} from "./services/peeringService.js";

export default async function (c) {
  if (!(await isUserAdmin(c))) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }
  const action = c.var.body.action;
  return handlers[action]
    ? await handlers[action](c)
    : makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
}

const handlers = {
  async setPost(c) {
    const { type, postId, category, title, content } = c.var.body;
    if (
      nullOrEmpty(category) ||
      typeof category !== "string" ||
      nullOrEmpty(title) ||
      typeof title !== "string" ||
      nullOrEmpty(content) ||
      typeof content !== "string" ||
      (type !== "add" && type !== "update")
    ) {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (type === "update") {
      if (nullOrEmpty(postId) || typeof postId !== "number")
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    try {
      const model = {
        category,
        title,
        content,
      };

      if (type === "update") {
        await c.var.app.models.posts.update(model, {
          where: { post_id: postId },
        });
      } else if (type === "add") {
        await c.var.app.models.posts.create(model);
      }
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async deletePost(c) {
    const postId = c.var.body.postId;
    if (nullOrEmpty(postId) || typeof postId !== "number")
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    try {
      const rows = await c.var.app.models.posts.destroy({
        where: {
          post_id: postId,
        },
      });
      if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async enumRouters(c) {
    const routers = [];
    try {
      const result = await c.var.app.models.routers.findAll({
        attributes: [
          "uuid",
          "name",
          "description",
          "location",
          "public",
          "open_peering",
          "auto_peering",
          "session_capacity",
          "callback_url",
          "ipv4",
          "ipv6",
          "ipv6_link_local",
          "link_types",
          "extensions",
          "agent_secret",
          "allowed_policies",
        ],
      });
      for (let i = 0; i < result.length; i++)
        routers.push({
          uuid: result[i].dataValues.uuid,
          name: result[i].dataValues.name,
          description: result[i].dataValues.description,
          location: result[i].dataValues.location,
          public: !!result[i].dataValues.public,
          openPeering: !!result[i].dataValues.open_peering,
          autoPeering: !!result[i].dataValues.auto_peering,
          sessionCapacity: result[i].dataValues.session_capacity,
          callbackUrl: result[i].dataValues.callback_url,
          sessionCount: await c.var.app.models.bgpSessions.count({
            where: {
              router: result[i].dataValues.uuid,
            },
          }),
          ipv4: result[i].dataValues.ipv4 || "",
          ipv6: result[i].dataValues.ipv6 || "",
          ipv6LinkLocal: result[i].dataValues.ipv6_link_local || "",
          linkTypes: result[i].dataValues.link_types
            ? JSON.parse(result[i].dataValues.link_types)
            : [],
          extensions: result[i].dataValues.extensions
            ? JSON.parse(result[i].dataValues.extensions)
            : [],
          agentSecret: result[i].dataValues.agent_secret || "",
          allowedPolicies: result[i].dataValues.allowed_policies
            ? JSON.parse(result[i].dataValues.allowed_policies)
            : [],
        });
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
    }
    return makeResponse(c, RESPONSE_CODE.OK, { routers });
  },

  async setRouter(c) {
    const {
      type,
      router,
      name,
      description,
      location,
      openPeering,
      autoPeering,
      sessionCapacity,
      callbackUrl,
      ipv4,
      ipv6,
      ipv6LinkLocal,
      linkTypes,
      extensions,
      agentSecret,
      availablePolicies,
    } = c.var.body;
    const _public = c.var.body.public;
    if (
      typeof name !== "string" ||
      typeof _public !== "boolean" ||
      typeof openPeering !== "boolean" ||
      typeof autoPeering !== "boolean" ||
      typeof agentSecret !== "string" ||
      nullOrEmpty(name) ||
      nullOrEmpty(agentSecret) ||
      nullOrEmpty(sessionCapacity) ||
      typeof sessionCapacity !== "number" ||
      typeof callbackUrl !== "string" ||
      nullOrEmpty(callbackUrl) ||
      !Array.isArray(linkTypes) ||
      linkTypes.some((e) => typeof e !== "string") ||
      (!nullOrEmpty(extensions) &&
        (!Array.isArray(extensions) ||
          extensions.some((e) => typeof e !== "string"))) ||
      (!nullOrEmpty(availablePolicies) &&
        (!Array.isArray(availablePolicies) ||
          availablePolicies.some((e) => typeof e !== "number" || isNaN(e)))) ||
      (!nullOrEmpty(description) && typeof description !== "string") ||
      (!nullOrEmpty(location) && typeof location !== "string") ||
      (!nullOrEmpty(ipv4) && typeof ipv4 !== "string") ||
      (!nullOrEmpty(ipv6) && typeof ipv6 !== "string") ||
      (!nullOrEmpty(ipv6LinkLocal) && typeof ipv6LinkLocal !== "string") ||
      (type !== "add" && type !== "update")
    ) {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (type === "update") {
      if (nullOrEmpty(router) || typeof router !== "string")
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    try {
      const model = {
        name,
        description,
        location,
        public: _public,
        openPeering,
        autoPeering,
        sessionCapacity,
        callbackUrl,
        ipv4,
        ipv6,
        ipv6LinkLocal,
        linkTypes: JSON.stringify(linkTypes),
        extensions: JSON.stringify(extensions),
        allowedPolicies: JSON.stringify(availablePolicies),
        agentSecret,
      };

      if (type === "update") {
        await c.var.app.models.routers.update(model, {
          where: { uuid: router },
        });
      } else if (type === "add") {
        await c.var.app.models.routers.create(model);
      }
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async deleteRouter(c) {
    const routerUuid = c.var.body.router;
    if (nullOrEmpty(routerUuid) || typeof routerUuid !== "string")
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    try {
      const rows = await c.var.app.models.routers.destroy({
        where: {
          uuid: routerUuid,
        },
      });
      if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async config(c) {
    try {
      const { netAsn, netName, netDesc, footerText, maintenanceText } =
        c.var.body;
      if (
        nullOrEmpty(netAsn) ||
        typeof netAsn !== "string" ||
        nullOrEmpty(netName) ||
        typeof netName !== "string" ||
        isNaN(Number(netAsn)) ||
        Number(netAsn) < ASN_MIN ||
        Number(netAsn) > ASN_MAX
      ) {
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
      }
      await c.var.app.models.settings.update(
        { value: netAsn },
        { where: { key: "NET_ASN" } }
      );
      await c.var.app.models.settings.update(
        { value: netName },
        { where: { key: "NET_NAME" } }
      );
      await c.var.app.models.settings.update(
        { value: netDesc || null },
        { where: { key: "NET_DESC" } }
      );
      await c.var.app.models.settings.update(
        { value: footerText || null },
        { where: { key: "FOOTER_TEXT" } }
      );
      await c.var.app.models.settings.update(
        { value: maintenanceText || null },
        { where: { key: "MAINTENANCE_TEXT" } }
      );
    } catch (error) {
      c.var.app.logger.getLogger("app").error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async enumSessions(c) {
    return await enumPeeringSessions(c, true);
  },

  async approveSession(c) {
    return await generalAgentHandler(c, "approve");
  },

  async teardownSession(c) {
    return await generalAgentHandler(c, "teardown");
  },

  async deleteSession(c) {
    return await generalAgentHandler(c, "delete");
  },

  async enableSession(c) {
    return await generalAgentHandler(c, "enable");
  },

  async disableSession(c) {
    return await generalAgentHandler(c, "disable");
  },

  async querySession(c) {
    return await queryPeeringSession(c);
  },
};
