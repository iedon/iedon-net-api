import { Sequelize } from 'sequelize';

export async function useDbContext(app, dbSettings) {
    const dbLogger = app.logger.getLogger('database');

    const sequelize = dbSettings.dialect === 'sqlite' ? new Sequelize({
        dialect: 'sqlite',
        storage: dbSettings.storage,
        dialectOptions: dbSettings.dialectOptions
    }) : new Sequelize(dbSettings.database, dbSettings.user, dbSettings.password || null, {
        dialect: dbSettings.dialect,
        host: dbSettings.host,
        port: dbSettings.port,
        pool: dbSettings.pool,
        logging: dbSettings.logging ? log => dbLogger.debug(log) : false,
        dialectOptions: dbSettings.dialectOptions
    });

    // database entities
    const models = {};
    const loadedModels = [ 'settings', 'routers', 'bgpSessions', 'posts', 'peerPreferences' ];
    loadedModels.forEach(async m => models[m] = (await import(`./models/${m}.js`)).initModel(sequelize))

    app.sequelize = sequelize;
    sequelize.sync(/*{ alter: true }*/).then(() => {
        models.settings.bulkCreate([
            {
                key: 'NET_NAME',
                value: 'iEdon.dn42'
            },
            {
                key: 'NET_DESC',
                value: 'iEdon.dn42 is an experimental global network within DN42'
            },
            {
                key: 'NET_ASN',
                value: '4242422189'
            },
            {
                key: 'MAINTENANCE_TEXT',
                value: ''
            },
            {
                key: 'FOOTER_TEXT',
                value: 'Powered by PeerAPI and Acorle'
            },
        ]).catch(error => {
            // Supress errors raised when records are already exist
            if (error.name !== 'SequelizeUniqueConstraintError') {
                if (dbSettings.logging) dbLogger.error(error)
            }
        });
    });

    app.use(async (ctx, next) => {
        ctx.models = models;
        return await next();
    });
};
