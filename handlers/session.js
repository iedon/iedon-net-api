import { BaseHandler } from "./base.js";
import { nullOrEmpty, IPV4_REGEX, IPV6_REGEX, ASN_MAX, ASN_MIN } from "../common/helper.js";

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
export class SessionHandler extends BaseHandler {

    constructor(app) {
        super(app);
        this.app.server.post('/session', async c => {
            const action = c.var.body.action;
            if (action === 'enum') return await this.enum(c);

            const routerUuid = c.var.body.router;
            if (nullOrEmpty(routerUuid) || typeof routerUuid !== 'string') return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            switch (action) {
                case 'add': return await this.add(c, routerUuid);
                case 'delete': return await this.delete(c, routerUuid);
                case 'enable': return await this.enable(c, routerUuid);
                case 'disable': return await this.disable(c, routerUuid);
                case 'query': return await this.query(c, routerUuid);
                case 'info': return await this.info(c, routerUuid);
                default: return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    async add(c, routerUuid) {
        const _ipv4 = c.var.body.ipv4;
        const _ipv6 = c.var.body.ipv6;
        const _ipv6_link_local = c.var.body.ipv6LinkLocal;
        const _type = c.var.body.type;
        const _extensions = c.var.body.extensions;
        let _endpoint = c.var.body.endpoint;
        const _credential = c.var.body.credential;
        const _data = c.var.body.data;

        if (
            (nullOrEmpty(_ipv4) && nullOrEmpty(_ipv6) && nullOrEmpty(_ipv6_link_local)) ||
            nullOrEmpty(_type) || typeof _type !== 'string' || nullOrEmpty(_data) ||
            // Uncomment bellow to disallow empty endpoit/credential
            // nullOrEmpty(_endpoint) ||
            // nullOrEmpty(_credential)) ||
            !Array.isArray(_extensions) || _extensions.some(e => typeof e !== 'string')
        ) {
            return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
        }

        // To see if current logged user has admin previlieges
        let isAdmin = false;
        try {
            const netAsn = (await c.var.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'NET_ASN' } })).dataValues.value || '';
            if (netAsn === c.var.state.asn) isAdmin = true;
        } catch (error) {
            c.var.app.logger.getLogger('auth').error(error);
            return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
        }

        const _asn = c.var.body.asn;
        if (isAdmin && (nullOrEmpty(_asn) || typeof _asn !== 'number' || _asn < ASN_MIN || _asn > ASN_MAX)) {
            return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
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
            return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
        }

        if (!nullOrEmpty(_endpoint)) {
            try {
                if (_endpoint.indexOf(':') === -1) throw new Error('Invalid endpoint');
                const url = new URL(`https://${_endpoint}`);
                _endpoint = url.host;
            } catch {
                return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            }
        }

        const transaction = await c.var.app.sequelize.transaction();
        try {
            const url = await this.getRouterCallbackUrl(c, routerUuid, transaction);
            if (!url) {
                await transaction.rollback();
                return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            const routerQuery = await c.var.models.routers.findOne({
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
                return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            }


            // Check whether the router is available to add a new session
            if (routerQuery && routerQuery.dataValues.session_capacity > 0) {
                const capacity = routerQuery.dataValues.session_capacity;
                const routerSessionCount = await c.var.models.bgpSessions.count({
                    where: {
                        router: routerUuid
                    },
                    transaction
                });

                // router is open and has enough capacity for new peerings
                if (capacity - routerSessionCount > 0) {

                    const mySessionCount = await c.var.models.bgpSessions.count({
                        where: {
                            router: routerUuid,
                            asn: Number(c.var.state.asn)
                        },
                        transaction
                    });

                    if (mySessionCount > 0xFF) throw new Error(`Too many sessions for peer "${c.var.state.asn}" on router "${routerUuid}"`);

                    const peerAsn = isAdmin ? _asn : Number(c.var.state.asn)
                    const ifname = `dn${peerAsn.toString(36)}${mySessionCount.toString(16)}`;
                    await c.var.models.bgpSessions.create({
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
                        const response = await c.var.app.fetch.post(url, {
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
            c.var.app.logger.getLogger('app').error(error);
            await transaction.rollback();
            return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
        }

        return this.makeResponse(c, this.RESPONSE_CODE.OK);
    }

    async delete(c, routerUuid) {
        return await this.simpleActionHandler(c, routerUuid, 'delete');
    }

    async enable(c, routerUuid) {
        return await this.simpleActionHandler(c, routerUuid, 'enable');
    }

    async disable(c, routerUuid) {
        return await this.simpleActionHandler(c, routerUuid, 'disable');
    }

    async info(c, routerUuid) {
        const data = c.var.body.data || '';

        const url = await this.getRouterCallbackUrl(c, routerUuid);
        if (!url) return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        const response = await c.var.app.fetch.post(url, {
            action: 'info',
            asn: c.var.state.asn,
            data
        }, 'json');

        if ((!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success)) return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        return this.makeResponse(c, this.RESPONSE_CODE.OK, response.data.data);
    }

    async query(c, routerUuid) {
        const sessionUuid = c.var.body.session;
        if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);

        const session = await this.getBgpSession(c, sessionUuid);
        if (!session) return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        // Reject requests are not belonging to this user
        if (session.asn !== Number(c.var.state.asn)) return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);

        if (session.status < 1) return this.makeResponse(c, this.RESPONSE_CODE.OK, '');

        const url = await this.getRouterCallbackUrl(c, routerUuid);
        if (!url) return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);

        const response = await c.var.app.fetch.post(url, {
            action: 'query',
            asn: c.var.state.asn,
            interface: session.interface,
            data: session.data || ''
        }, 'json');

        if ((!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success)) return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        return this.makeResponse(c, this.RESPONSE_CODE.OK, response.data.data);
    }

    async enum(c) {
        const sessions = [];
        try {
            const result = await c.var.models.bgpSessions.findAll({
                attributes: [
                                'uuid', 'router', 'status', 'ipv4', 'ipv6', 'ipv6_link_local', 'type',
                                'extensions', 'interface', 'endpoint', 'credential', 'data'
                            ],
                where: {
                    asn: Number(c.var.state.asn)
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
            c.var.app.logger.getLogger('app').error(error);
            return this.makeResponse(c, this.RESPONSE_CODE.SERVER_ERROR);
        }
        return this.makeResponse(c, this.RESPONSE_CODE.OK, { sessions });
    }

    async getRouterCallbackUrl(c, routerUuid, transaction=null) {
        const options = {
            attributes: [ 'callback_url' ],
            where: {
                uuid: routerUuid,
                public: true
            }
        };
        if (transaction !== null) Object.assign(options, { transaction });
        const result = await c.var.models.routers.findOne(options);
        return result ? result.dataValues.callback_url : null;
    }

    async getBgpSession(c, uuid, transaction=null) {
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
        const result = await c.var.models.bgpSessions.findOne(options);
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

    async simpleActionHandler(c, routerUuid, action) {
        const sessionUuid = c.var.body.session;
        if (nullOrEmpty(sessionUuid) || typeof sessionUuid !== 'string') return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);

        const transaction = await c.var.app.sequelize.transaction();
        try {
            const session = await this.getBgpSession(c, sessionUuid, transaction);
            if (!session) {
                await transaction.rollback();
                return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            // Reject requests are not belonging to this user
            if (session.asn !== Number(c.var.state.asn)) {
                await transaction.rollback();
                return this.makeResponse(c, this.RESPONSE_CODE.BAD_REQUEST);
            }

            const url = await this.getRouterCallbackUrl(c, routerUuid, transaction);
            if (!url) {
                await transaction.rollback();
                return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_NOT_AVAILABLE);
            }

            const response = await c.var.app.fetch.post(url, {
                action,
                session
            }, 'json');

            if (!response || response.status !== 200 || nullOrEmpty(response.data) || !response.data.success) {
                throw new Error(`Calling router's callback failed: ${response ? `HTTP Status ${response.status}` : 'Null response'}`);
            }

            if (action === 'delete') {
                const rows = await c.var.models.bgpSessions.destroy({
                    where: { uuid: sessionUuid },
                    transaction
                });
                if (rows !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
            } else {
                const rows = await c.var.models.bgpSessions.update({ status: (action === 'enable' || action === 'approve') ? 1 : 0 }, { where: { uuid: sessionUuid }, transaction }) 
                if (rows[0] !== 1) throw new Error(`Unexpected affected rows. ${rows}`);
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            c.var.app.logger.getLogger('app').error(error);
            return this.makeResponse(c, this.RESPONSE_CODE.ROUTER_OPERATION_FAILED);
        }

        return this.makeResponse(c, this.RESPONSE_CODE.OK);
    }

}
