import { Sequelize } from "sequelize";

export async function useDbContext(app, dbSettings) {
  const dbLogger = app.logger.getLogger("database");

  const sequelizeOptions = {
    dialect: dbSettings.dialect,
    logging: dbSettings.logging ? (log) => dbLogger.debug(log) : false,
    dialectOptions: dbSettings.dialectOptions,
  };

  if (dbSettings.dialect === "sqlite") {
    sequelizeOptions.storage = dbSettings.storage;
  } else {
    Object.assign(sequelizeOptions, {
      host: dbSettings.host,
      port: dbSettings.port,
      database: dbSettings.database,
      username: dbSettings.user,
      password: dbSettings.password || null,
      pool: dbSettings.pool,
    });
  }

  const sequelize = new Sequelize(sequelizeOptions);

  // database entities
  const models = {};
  const loadedModels = [
    "settings",
    "routers",
    "bgpSessions",
    "posts",
    "peerPreferences",
  ];

  await Promise.all(
    loadedModels.map(async (m) => {
      models[m] = (await import(`./models/${m}.js`)).initModel(sequelize);
    })
  );

  app.sequelize = sequelize;

  try {
    await sequelize.sync({ alter: dbSettings.alter || false });
    await models.settings.bulkCreate(
      [
        { key: "NET_NAME", value: "iEdon.dn42" },
        {
          key: "NET_DESC",
          value: "iEdon.dn42 is an experimental global network within DN42",
        },
        { key: "NET_ASN", value: "4242422189" },
        { key: "MAINTENANCE_TEXT", value: "" },
        { key: "FOOTER_TEXT", value: "Powered by PeerAPI and Acorle" },
      ],
      { ignoreDuplicates: true }
    );
  } catch (error) {
    if (dbSettings.logging && error.name !== "SequelizeUniqueConstraintError") {
      dbLogger.error(error);
    }
  }

  app.models = models;
}
