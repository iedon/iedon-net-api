const BaseHandler = require("./baseHandler");
const { nullOrEmpty, IPV4_REGEX, IPV6_REGEX, ASN_MAX, ASN_MIN } = require("../common/helper");

/*
    "REQUEST": {
        "action": "add" | "delete" | "up" | "down" | "info",
    },

    "RESPSONE": { // if type === routers
        "routers": [
            {
                "uuid": "1a2b3c4d5e6f1a2b3c4d5e6f",
                "name": "JP-TYO",
                "description": "Tokyo, Japan",
                "location": "JP",
                "openPeering": true,
                "sessionCapacity": 30,
                "sessionCount": 1
            },
            // ...
        ]
    },

*/

// WARNING: Possible concurrency problems in this class
// TODO: Improve: External I/O Request in Transaction
module.exports = class SessionHandler extends BaseHandler {

    constructor(router) {
        super(router);
        this.router.post('/session', async (ctx, _) => {
            const action = ctx.request.body.action;
            if (action === 'enum') return await this.enum(ctx);

            const routerUuid = ctx.request.body.router;
            if (nullOrEmpty(routerUuid) || typeof routerUuid !== 'string') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            switch (action) {
                case 'add': return await this.add(ctx, routerUuid);
                case 'delete': return await this.delete(ctx, routerUuid);
                case 'enable': return await this.enable(ctx, routerUuid);
                case 'disable': return await this.disable(ctx, routerUuid);
                case 'query': return await this.query(ctx, routerUuid);
                case 'info': return await this.info(ctx, routerUuid);
                default: return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    async add(ctx, routerUuid) {
        const _ipv4 = ctx.request.body.ipv4;
        const _ipv6 = ctx.request.body.ipv6;
        const _ipv6_link_local = ctx.request.body.ipv6LinkLocal;
        const _type = ctx.request.body.type;
        const _extensions = ctx.request.body.extensions;
        let _endpoint = ctx.request.body.endpoint;
        const _credential = ctx.request.body.credential;
        const _data = ctx.request.body.data;

        if (
            (nullOrEmpty(_ipv4) && nullOrEmpty(_ipv6) && nullOrEmpty(_ipv6_link_local)) ||
            nullOrEmpty(_type) || typeof _type !== 'string' || nullOrEmpty(_data) ||
            // Uncomment bellow to disallow empty endpoit/credential
            // nullOrEmpty(_endpoint) ||
            // nullOrEmpty(_credential)) ||
            !Array.isArray(_extensions) || _extensions.some(e => typeof e !== 'string')
        ) {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        // To see if current logged user has admin previlieges
        let isAdmin = false;
        try {
            const netAsn = (await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'NET_ASN' } })).dataValues.value || '';
            if (netAsn === ctx.state.asn) isAdmin = true;
        } catch (error) {
            ctx.app.logger.getLogger('auth').error(error);
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        const _asn = ctx.request.body.asn;
        if (isAdmin && (nullOrEmpty(_asn) || typeof _asn !== 'number' || _asn < ASN_MIN || _asn > ASN_MAX)) {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        if ((!nullOrEmpty(_ipv4) && typeof _ipv4 !== 'string') ||
            (!nullOrEmpty(_ipv6) && typeof _ipv6 !== 'string') ||
            (!nullOrEmpty(_ipv6_link_local) && typeof _ipv6_link_local !== 'string') ||
            (!nullOrEmpty(_ipv4) && !IPV4_REGEX.test(_ipv4)) ||
            (!nullOrEmpty(_ipv6) && !IPV6_REGEX.test(_ipv6)) ||
            (!nullOrEmpty(_ipv6_link_local) && !IPV6_REGEX.test(_ipv6_link_local)) ||
            (!nullOrEmpty(_endpoint) && typeof _endpoint !== 'string') ||
            (!nullOrEmpty(_credential) && typeof _credential !== 'string')
        ) {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        if (!nullOrEmpty(_endpoint)) {
            try {
                if (_endpoint.indexOf(':') === -1) throw new Error('Invalid endpoint');
                const url = new URL(`https://${_endpoint}`);
                _endpoint = url.host;
            } catch {
                return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }
        }

        const transaction = await ctx.app.sequelize.transaction();
        try {
            const url = await this.getRouterCallbackUrl(ctx, routerUuid, transaction);
            if (!url) {
                await transaction.rollback();
                return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            const routerQuery = await ctx.models.routers.findOne({
                attributes: [ 'auto_peering', 'session_capacity', 'ipv4', 'ipv6', 'ipv6_link_local', 'link_types', 'extensions' ],
                where: {
                    uuid: routerUuid,
                    public: true,
                    open_peering: true
                },
                transaction
            });

            let extensions = [];
            try {
                extensions = _extensions;
                const typeExist = JSON.parse(routerQuery.dataValues.link_types).some(type => type === _type);
                const extensionExist = extensions.length === 0 || extensions.some(_e => JSON.parse(routerQuery.dataValues.extensions).some(e => e === _e));
                if (!typeExist || !extensionExist) throw new Error('Invalid link type or extension');
            } catch {
                // This also supresses JSON exception
                await transaction.rollback();
                return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }


            // Check whether the router is available to add a new session
            if (routerQuery && routerQuery.dataValues.session_capacity > 0) {
                const capacity = routerQuery.dataValues.session_capacity;
                const routerSessionCount = await ctx.models.bgpSessions.count({
                    where: {
                        router: routerUuid
                    },
                    transaction
                });

                // router is open and has enough capacity for new peerings
                if (capacity - routerSessionCount > 0) {

                    const mySessionCount = await ctx.models.bgpSessions.count({
                        where: {
                            router: routerUuid,
                            asn: Number(ctx.state.asn)
                        },
                        transaction
                    });

                    if (mySessionCount > 0xFF) throw new Error(`Too many sessions for peer "${ctx.state.asn}" on router "${routerUuid}"`);

                    const peerAsn = isAdmin ? _asn : Number(ctx.state.asn)
                    const ifname = `dn${peerAsn.toString(36)}${mySessionCount.toString(16)}`;
                    await ctx.models.bgpSessions.create({
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
                    }, { transaction });

                    if (routerQuery.dataValues.auto_peering) {
                        const response = await ctx.app.fetch.post(url, {
                            action: 'add',
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
                            data: _data
                        }, 'json');

                        if (!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success) {
                            throw new Error(`Calling router's callback failed: ${response ? `HTTP Status ${response.status}` : 'Null response'}`);
                        }
                    }
                }
            }

            await transaction.commit();
        } catch (error) {
            ctx.app.logger.getLogger('app').error(error);
            await transaction.rollback();
            return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
        }

        return this.makeResponse(ctx, this.RESPONSE_CODE.OK);
    }

    async delete(ctx, routerUuid) {
        return await this.simpleActionHandler(ctx, routerUuid, 'delete');
    }

    async enable(ctx, routerUuid) {
        return await this.simpleActionHandler(ctx, routerUuid, 'enable');
    }

    async disable(ctx, routerUuid) {
        return await this.simpleActionHandler(ctx, routerUuid, 'disable');
    }

    async info(ctx, routerUuid) {
        const data = ctx.request.body.data || '';

        const url = await this.getRouterCallbackUrl(ctx, routerUuid);
        if (!url) return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        const response = await ctx.app.fetch.post(url, {
            action: 'info',
            asn: ctx.state.asn,
            data
        }, 'json');

        if ((!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success)) return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        return this.makeResponse(ctx, this.RESPONSE_CODE.OK, response.data.data);
    }

    async query(ctx, routerUuid) {
        const sessionUuid = ctx.request.body.session;
        if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);

        const session = await this.getBgpSession(ctx, sessionUuid);
        if (!session) return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        // Reject requests are not belonging to this user
        if (session.asn !== Number(ctx.state.asn)) return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);

        if (session.status < 1) return this.makeResponse(ctx, this.RESPONSE_CODE.OK, '');

        const url = await this.getRouterCallbackUrl(ctx, routerUuid);
        if (!url) return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        const response = await ctx.app.fetch.post(url, {
            action: 'query',
            asn: ctx.state.asn,
            interface: session.interface,
            data: session.data || ''
        }, 'json');

        if ((!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success)) return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        return this.makeResponse(ctx, this.RESPONSE_CODE.OK, response.data.data);
    }

    async enum(ctx) {
        const sessions = [];
        try {
            const result = await ctx.models.bgpSessions.findAll({
                attributes: [
                                'uuid', 'router', 'status', 'ipv4', 'ipv6', 'ipv6_link_local', 'type',
                                'extensions', 'interface', 'endpoint', 'credential', 'data'
                            ],
                where: {
                    asn: Number(ctx.state.asn)
                }
            });
            for (let i = 0; i < result.length; i++) sessions.push({
                uuid: result[i].dataValues.uuid,
                router: result[i].dataValues.router,
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
            ctx.app.logger.getLogger('app').error(error);
            return this.makeResponse(ctx, this.RESPONSE_CODE.SERVER_ERROR);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, { sessions });
    }

    async getRouterCallbackUrl(ctx, routerUuid, transaction=null) {
        const options = {
            attributes: [ 'callback_url' ],
            where: {
                uuid: routerUuid,
                public: true
            }
        };
        if (transaction !== null) Object.assign(options, { transaction });
        const result = await ctx.models.routers.findOne(options);
        return result ? result.dataValues.callback_url : null;
    }

    async getBgpSession(ctx, uuid, transaction=null) {
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
        const result = await ctx.models.bgpSessions.findOne(options);
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
    }

    async simpleActionHandler(ctx, routerUuid, action) {
        const sessionUuid = ctx.request.body.session;
        if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);

        const transaction = await ctx.app.sequelize.transaction();
        try {
            const session = await this.getBgpSession(ctx, sessionUuid, transaction);
            if (!session) {
                await transaction.rollback();
                return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            // Reject requests are not belonging to this user
            if (session.asn !== Number(ctx.state.asn)) {
                await transaction.rollback();
                return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }

            const url = await this.getRouterCallbackUrl(ctx, routerUuid, transaction);
            if (!url) {
                await transaction.rollback();
                return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            const response = await ctx.app.fetch.post(url, {
                action,
                session
            }, 'json');

            if (!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success) {
                throw new Error(`Calling router's callback failed: ${response ? `HTTP Status ${response.status}` : 'Null response'}`);
            }

            if (action === 'delete') {
                const rows = await ctx.models.bgpSessions.destroy({
                    where: { uuid: sessionUuid },
                    transaction
                });
                if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
            } else {
                const rows = await ctx.models.bgpSessions.update({ status: (action === 'enable' || action === 'approve') ? 1 : 0 }, { where: { uuid: sessionUuid }, transaction }) 
                if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            ctx.app.logger.getLogger('app').error(error);
            return this.makeResponse(ctx, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        }

        return this.makeResponse(ctx, this.RESPONSE_CODE.OK);
    }

}
