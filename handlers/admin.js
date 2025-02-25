import { makeResponse, RESPONSE_CODE } from "../common/packet.js";
import { nullOrEmpty, ASN_MIN, ASN_MAX } from "../common/helper.js";

// WARNING: Possible concurrency problems in this class
// TODO: Improve: External I/O Request in Transaction
export default async function (c) {
  // To see if current logged user has admin previlieges
  try {
    const netAsn = (await c.var.app.models.settings.findOne({ attributes: ['value'], where: { key: 'NET_ASN' } })).dataValues.value || '';
    if (netAsn !== c.var.state.asn) return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  } catch (error) {
    c.var.app.logger.getLogger('auth').error(error);
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  const action = c.var.body.action;
  return handlers[action] ? await handlers[action](c) : makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
}

const handlers = {
  async setPost(c) {
    const { type, postId, category, title, content } = c.var.body;
    if (nullOrEmpty(category) || typeof category !== 'string' ||
      nullOrEmpty(title) || typeof title !== 'string' ||
      nullOrEmpty(content) || typeof content !== 'string' ||
      (type !== 'add' && type !== 'update')) {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (type === 'update') {
      if (nullOrEmpty(postId) || typeof postId !== 'number') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    try {
      const model = {
        category,
        title,
        content
      };

      if (type === 'update') {
        await c.var.app.models.posts.update(model, { where: { post_id: postId } });
      } else if (type === 'add') {
        await c.var.app.models.posts.create(model);
      }

    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async deletePost(c) {
    const postId = c.var.body.postId;
    if (nullOrEmpty(postId) || typeof postId !== 'number') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    try {
      const rows = await c.var.app.models.posts.destroy({
        where: {
          post_id: postId
        }
      });
      if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async enumRouters(c) {
    const routers = [];
    try {
      const result = await c.var.app.models.routers.findAll({
        attributes: [
          'uuid', 'name', 'description', 'location', 'public', 'open_peering', 'auto_peering', 'session_capacity',
          'callback_url', 'ipv4', 'ipv6', 'ipv6_link_local', 'link_types', 'extensions'
        ]
      });
      for (let i = 0; i < result.length; i++) routers.push({
        uuid: result[i].dataValues.uuid,
        name: result[i].dataValues.name,
        description: result[i].dataValues.description,
        location: result[i].dataValues.location,
        public: !!result[i].dataValues.public,
        openPeering: !!result[i].dataValues.open_peering,
        autoPeering: !!result[i].dataValues.auto_peering,
        sessionCapacity: result[i].dataValues.session_capacity,
        callbackUrl: result[i].dataValues.callback_url,
        sessionCount: (await c.var.app.models.bgpSessions.count({
          where: {
            router: result[i].dataValues.uuid
          }
        })),
        ipv4: result[i].dataValues.ipv4 || '',
        ipv6: result[i].dataValues.ipv6 || '',
        ipv6LinkLocal: result[i].dataValues.ipv6_link_local || '',
        linkTypes: result[i].dataValues.link_types ? JSON.parse(result[i].dataValues.link_types) : [],
        extensions: result[i].dataValues.extensions ? JSON.parse(result[i].dataValues.extensions) : []
      });
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
    }
    return makeResponse(c, RESPONSE_CODE.OK, { routers });
  },

  async setRouter(c) {
    const { type, router, name, description, location, openPeering, autoPeering, sessionCapacity, callbackUrl, ipv4, ipv6, ipv6LinkLocal, linkTypes, extensions } = c.var.body;
    const _public = c.var.body.public;
    if (nullOrEmpty(name) || typeof name !== 'string' ||
      typeof _public !== 'boolean' || typeof openPeering !== 'boolean' || typeof autoPeering !== 'boolean' ||
      nullOrEmpty(sessionCapacity) || typeof sessionCapacity !== 'number' ||
      nullOrEmpty(callbackUrl) || typeof callbackUrl !== 'string' ||
      !Array.isArray(linkTypes) || linkTypes.some(e => typeof e !== 'string') ||
      (!nullOrEmpty(extensions) && (!Array.isArray(extensions) || extensions.some(e => typeof e !== 'string'))) ||
      (!nullOrEmpty(description) && typeof description !== 'string') ||
      (!nullOrEmpty(location) && typeof location !== 'string') ||
      (!nullOrEmpty(ipv4) && typeof ipv4 !== 'string') ||
      (!nullOrEmpty(ipv6) && typeof ipv6 !== 'string') ||
      (!nullOrEmpty(ipv6LinkLocal) && typeof ipv6LinkLocal !== 'string') ||
      (type !== 'add' && type !== 'update')) {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (type === 'update') {
      if (nullOrEmpty(router) || typeof router !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
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
        extensions: JSON.stringify(extensions)
      };

      if (type === 'update') {
        await c.var.app.models.routers.update(model, { where: { uuid: router } });
      } else if (type === 'add') {
        await c.var.app.models.routers.create(model);
      }

    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async deleteRouter(c) {
    const routerUuid = c.var.body.router;
    if (nullOrEmpty(routerUuid) || typeof routerUuid !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    try {
      const rows = await c.var.app.models.routers.destroy({
        where: {
          uuid: routerUuid
        }
      });
      if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async config(c) {
    try {
      const { netAsn, netName, netDesc, footerText, maintenanceText } = c.var.body;
      if (nullOrEmpty(netAsn) || typeof netAsn !== 'string' ||
        nullOrEmpty(netName) || typeof netName !== 'string' ||
        isNaN(Number(netAsn)) || Number(netAsn) < ASN_MIN || Number(netAsn) > ASN_MAX) {
        return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
      }
      await c.var.app.models.settings.update({ value: netAsn }, { where: { key: 'NET_ASN' } });
      await c.var.app.models.settings.update({ value: netName }, { where: { key: 'NET_NAME' } });
      await c.var.app.models.settings.update({ value: netDesc || null }, { where: { key: 'NET_DESC' } });
      await c.var.app.models.settings.update({ value: footerText || null }, { where: { key: 'FOOTER_TEXT' } });
      await c.var.app.models.settings.update({ value: maintenanceText || null }, { where: { key: 'MAINTENANCE_TEXT' } });
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK);
  },

  async enumSessions(c) {
    const sessions = [];
    try {
      const result = await c.var.app.models.bgpSessions.findAll({
        attributes: [
          'uuid', 'router', 'asn', 'status', 'ipv4', 'ipv6', 'ipv6_link_local', 'type',
          'extensions', 'interface', 'endpoint', 'credential', 'data'
        ]
      });
      for (let i = 0; i < result.length; i++) sessions.push({
        uuid: result[i].dataValues.uuid,
        router: result[i].dataValues.router,
        asn: String(result[i].dataValues.asn),
        status: result[i].dataValues.status,
        ipv4: result[i].dataValues.ipv4,
        ipv6: result[i].dataValues.ipv6,
        ipv6LinkLocal: result[i].dataValues.ipv6_link_local,
        type: result[i].dataValues.type,
        extensions: result[i].dataValues.extensions ? JSON.parse(result[i].dataValues.extensions) : [],
        interface: result[i].dataValues.interface,
        endpoint: result[i].dataValues.endpoint,
        credential: result[i].dataValues.credential,
        data: result[i].dataValues.data ? JSON.parse(result[i].dataValues.data) : ''
      });
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.SERVER_ERROR);
    }
    return makeResponse(c, RESPONSE_CODE.OK, { sessions });
  },

  async approveSession(c) {
    return await handlers.simpleActionHandler(c, 'approve');
  },

  async deleteSession(c) {
    return await handlers.simpleActionHandler(c, 'delete');
  },

  async enableSession(c) {
    return await handlers.simpleActionHandler(c, 'enable');
  },

  async disableSession(c) {
    return await handlers.simpleActionHandler(c, 'disable');
  },

  async querySession(c) {
    const sessionUuid = c.var.body.session;
    if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    const routerUuid = c.var.body.router;
    if (nullOrEmpty(routerUuid) || typeof routerUuid !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    const session = await handlers.getBgpSession(c, sessionUuid);
    if (!session) return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

    if (session.status < 1) return makeResponse(c, RESPONSE_CODE.OK, '');

    const url = await handlers.getRouterCallbackUrl(c, routerUuid);
    if (!url) return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

    const response = await c.var.app.fetch.post(url, {
      action: 'query',
      asn: String(session.asn),
      interface: session.interface,
      data: session.data || ''
    }, 'json');

    if ((!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success)) return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
    return makeResponse(c, RESPONSE_CODE.OK, response.data.data);
  },

  async getRouterCallbackUrl(c, routerUuid, transaction = null) {
    const options = {
      attributes: ['callback_url'],
      where: {
        uuid: routerUuid,
        public: true
      }
    };
    if (transaction !== null) Object.assign(options, { transaction });
    const result = await c.var.app.models.routers.findOne(options);
    return result ? result.dataValues.callback_url : null;
  },

  async getBgpSession(c, uuid, transaction = null) {
    const options = {
      attributes: [
        'asn', 'status', 'ipv4', 'ipv6', 'ipv6_link_local', 'type',
        'extensions', 'interface', 'endpoint', 'credential', 'data'
      ],
      where: {
        uuid
      }
    };
    if (transaction !== null) Object.assign(options, { transaction });
    const result = await c.var.app.models.bgpSessions.findOne(options);
    return result ? {
      asn: result.dataValues.asn,
      status: result.dataValues.status,
      ipv4: result.dataValues.ipv4,
      ipv6: result.dataValues.ipv6,
      ipv6LinkLocal: result.dataValues.ipv6_link_local,
      type: result.dataValues.type,
      extensions: result.dataValues.extensions ? JSON.parse(result.dataValues.extensions) : [],
      interface: result.dataValues.interface,
      endpoint: result.dataValues.endpoint,
      credential: result.dataValues.credential,
      data: result.dataValues.data ? JSON.parse(result.dataValues.data) : ''
    } : null;
  },

  async simpleActionHandler(c, action) {
    const routerUuid = c.var.body.router;
    if (nullOrEmpty(routerUuid) || typeof routerUuid !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    const sessionUuid = c.var.body.session;
    if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);

    const transaction = await c.var.app.sequelize.transaction();
    try {

      const url = await handlers.getRouterCallbackUrl(c, routerUuid, transaction);
      if (!url) {
        await transaction.rollback();
        return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
      }

      const session = await handlers.getBgpSession(c, sessionUuid, transaction);
      if (!session) {
        await transaction.rollback();
        return makeResponse(c, RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
      }

      const response = await c.var.app.fetch.post(url, {
        action,
        session
      }, 'json');

      if (!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success) {
        throw new Error(`Calling router's callback failed: ${response ? `HTTP Status ${response.status}` : 'Null response'}`);
      }

      if (action === 'delete') {
        const rows = await c.var.app.models.bgpSessions.destroy({
          where: { uuid: sessionUuid },
          transaction
        });
        if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
      } else {
        const rows = await c.var.app.models.bgpSessions.update({ status: (action === 'enable' || action === 'approve') ? 1 : 0 }, { where: { uuid: sessionUuid }, transaction })
        if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      c.var.app.logger.getLogger('app').error(error);
      return makeResponse(c, RESPONSE_CODE.ROUTER_OPERATION_FAILED);
    }

    return makeResponse(c, RESPONSE_CODE.OK);
  }
}
