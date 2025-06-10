import { nullOrEmpty } from "../common/helper.js";
import { makeResponse, RESPONSE_CODE } from "../common/packet.js";

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

export default async function (c) {
  const { type, postId } = c.req.param();
  if (type !== "post" && !nullOrEmpty(postId))
    return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  switch (type) {
    case "routers":
      return await routers(c);
    case "posts":
      return await posts(c);
    case "post":
      return await post(c, postId);
    case "config":
      return await config(c);
    default:
      return makeResponse(c, RESPONSE_CODE.NOT_FOUND);
  }
}

async function routers(c) {
  const routers = [];
  try {
    const result = await c.var.app.models.routers.findAll({
      attributes: [
        "uuid",
        "name",
        "description",
        "location",
        "open_peering",
        "auto_peering",
        "session_capacity",
        "ipv4",
        "ipv6",
        "ipv6_link_local",
        "link_types",
        "extensions",
      ],
      where: {
        public: true,
      },
    });

    // Prepare router data without session counts
    const routerData = result.map((router) => ({
      uuid: router.dataValues.uuid,
      name: router.dataValues.name,
      description: router.dataValues.description,
      location: router.dataValues.location,
      openPeering: !!router.dataValues.open_peering,
      autoPeering: !!router.dataValues.auto_peering,
      sessionCapacity: router.dataValues.session_capacity,
      sessionCount: 0, // Will be filled later
      ipv4: router.dataValues.ipv4 || "",
      ipv6: router.dataValues.ipv6 || "",
      ipv6LinkLocal: router.dataValues.ipv6_link_local || "",
      linkTypes: router.dataValues.link_types
        ? JSON.parse(router.dataValues.link_types)
        : [],
      extensions: router.dataValues.extensions
        ? JSON.parse(router.dataValues.extensions)
        : [],
    }));

    // Process in batches of 5 for session counting
    const batchSize = 5;
    for (let i = 0; i < routerData.length; i += batchSize) {
      const batch = routerData.slice(i, i + batchSize);
      const sessionCountPromises = batch.map((router) =>
        c.var.app.models.bgpSessions
          .count({
            where: {
              router: router.uuid,
            },
          })
          .then((count) => {
            router.sessionCount = count;
          })
      );

      const metricPromises = batch.map((router) =>
        c.var.app.redis.getData(`router:${router.uuid}`).then((metric) => {
          if (metric) router.metric = metric;
        })
      );

      // Wait for the current batch to complete
      await Promise.allSettled([
        Promise.allSettled(sessionCountPromises),
        Promise.allSettled(metricPromises),
      ]);
    }

    routers.push(...routerData);
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
  }
  return makeResponse(c, RESPONSE_CODE.OK, { routers });
}

async function posts(c) {
  const posts = [];
  try {
    (
      await c.var.app.models.posts.findAll({
        attributes: [
          "post_id",
          "category",
          "title",
          "created_at",
          "updated_at",
        ],
      })
    ).forEach((e) => {
      posts.push({
        postId: e.dataValues.post_id,
        category: e.dataValues.category,
        title: e.dataValues.title,
        createdAt: e.dataValues.created_at,
        updatedAt: e.dataValues.updated_at,
      });
    });
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
  }
  return makeResponse(c, RESPONSE_CODE.OK, { posts });
}

async function post(c, postId) {
  if (isNaN(Number(postId))) return makeResponse(c, RESPONSE_CODE.NOT_FOUND);

  let post = null;
  try {
    const result = await c.var.app.models.posts.findOne({
      attributes: [
        "post_id",
        "category",
        "title",
        "content",
        "created_at",
        "updated_at",
      ],
      where: {
        post_id: Number(postId),
      },
    });
    if (result) {
      post = {
        postId: result.dataValues.post_id,
        category: result.dataValues.category,
        title: result.dataValues.title,
        content: result.dataValues.content,
        createdAt: result.dataValues.created_at,
        updatedAt: result.dataValues.updated_at,
      };
    } else {
      return makeResponse(c, RESPONSE_CODE.NOT_FOUND);
    }
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
  }
  return makeResponse(c, RESPONSE_CODE.OK, post);
}

async function config(c) {
  let config = null;
  try {
    const netAsn = await c.var.app.models.settings.findOne({
      attributes: ["value"],
      where: { key: "NET_ASN" },
    });
    const netName = await c.var.app.models.settings.findOne({
      attributes: ["value"],
      where: { key: "NET_NAME" },
    });
    const netDesc = await c.var.app.models.settings.findOne({
      attributes: ["value"],
      where: { key: "NET_DESC" },
    });
    const footerText = await c.var.app.models.settings.findOne({
      attributes: ["value"],
      where: { key: "FOOTER_TEXT" },
    });
    const maintenanceText = await c.var.app.models.settings.findOne({
      attributes: ["value"],
      where: { key: "MAINTENANCE_TEXT" },
    });
    config = {
      netAsn: netAsn.dataValues?.value || "",
      netName: netName.dataValues?.value || "",
      netDesc: netDesc.dataValues?.value || "",
      footerText: footerText.dataValues?.value || "",
      maintenanceText: maintenanceText.dataValues?.value || "",
    };
  } catch (error) {
    c.var.app.logger.getLogger("app").error(error);
  }
  return makeResponse(c, RESPONSE_CODE.OK, config);
}
