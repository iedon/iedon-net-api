const { nullOrEmpty } = require("../common/helper");
const BaseHandler = require("./baseHandler");

/*
    "REQUEST": {
        "type": "routers" | "posts"
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

    "RESPSONE": { // if type === posts
        "posts": [
            {
                "postId": 0,
                "category": "announcement",
                "title": "aaaaaa",
                "content": "bbbbbbb",
                "createdAt": "xxxxxTxxxxxZ",
                "updatedAt": "xxxxxTxxxxxZ",
            },
            // ...
        ]
    },

*/

module.exports = class ListHandler extends BaseHandler {

    constructor(router) {
        super(router);
        this.router.post('/list', async (ctx, _) => {
            const type = ctx.request.body.type;
            switch (type) {
                case 'routers': return await this.routers(ctx);
                case 'posts': return await this.posts(ctx);
                case 'post': return await this.post(ctx);
                case 'config': return await this.config(ctx);
                default: return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    async routers(ctx) {
        const routers = [];
        try {
            const result = await ctx.models.routers.findAll({
                attributes: [
                    'uuid', 'name', 'description', 'location', 'open_peering', 'auto_peering', 'session_capacity',
                    'ipv4', 'ipv6', 'ipv6_link_local', 'link_types', 'extensions'
                ],
                where: {
                    public: true
                }
            });
            for (let i = 0; i < result.length; i++) routers.push({
                uuid: result[i].dataValues.uuid,
                name: result[i].dataValues.name,
                description: result[i].dataValues.description,
                location: result[i].dataValues.location,
                openPeering: !!result[i].dataValues.open_peering,
                autoPeering: !!result[i].dataValues.auto_peering,
                sessionCapacity: result[i].dataValues.session_capacity,
                sessionCount: (await ctx.models.bgpSessions.count({
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
            ctx.app.logger.getLogger('app').error(error);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, { routers });
    }

    async posts(ctx) {
        const posts = [];
        try {
            (await ctx.models.posts.findAll({
                attributes: [ 'post_id', 'category', 'title', 'created_at', 'updated_at' ]
            })).forEach(e => {
                posts.push({
                    postId: e.dataValues.post_id,
                    category: e.dataValues.category,
                    title: e.dataValues.title,
                    createdAt: e.dataValues.created_at,
                    updatedAt: e.dataValues.updated_at
                });
            });
        } catch (error) {
            ctx.app.logger.getLogger('app').error(error);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, { posts });
    }

    async post(ctx) {
        const postId = ctx.request.body.postId;
        if (nullOrEmpty(postId) || typeof postId !== 'number') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);

        let post = null;
        try {
            const result = await ctx.models.posts.findOne({
                attributes: [ 'post_id', 'category', 'title', 'content', 'created_at', 'updated_at' ],
                where: {
                    post_id: postId
                }
            });
            if (result) {
                post = {
                    postId: result.dataValues.post_id,
                    category: result.dataValues.category,
                    title: result.dataValues.title,
                    content: result.dataValues.content,
                    createdAt: result.dataValues.created_at,
                    updatedAt: result.dataValues.updated_at
                }
            }
        } catch (error) {
            ctx.app.logger.getLogger('app').error(error);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, post);
    }

    async config(ctx) {
        let config = null;
        try {
            const netAsn = await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'NET_ASN' } });
            const netName = await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'NET_NAME' } });
            const netDesc = await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'NET_DESC' } });
            const footerText = await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'FOOTER_TEXT' } });
            const maintenanceText = await ctx.models.settings.findOne({ attributes: [ 'value' ], where: { key: 'MAINTENANCE_TEXT' } });
            config = {
                netAsn: netAsn.dataValues?.value || '',
                netName: netName.dataValues?.value || '',
                netDesc: netDesc.dataValues?.value || '',
                footerText: footerText.dataValues?.value || '',
                maintenanceText: maintenanceText.dataValues?.value || ''
            }
        } catch (error) {
            ctx.app.logger.getLogger('app').error(error);
        }
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, config);
    }
}
