import KoaRouter from 'koa-router'
const _router = new KoaRouter()

export async function useRouter(app) {
    app._routeClasses={}
    for (let i = 0; i < app.settings.handlers.length; i++) {
        const h = app.settings.handlers[i];
        if (h !== 'base') {
            const handlerName = `${h.charAt(0).toUpperCase() + h.slice(1)}Handler`;
            app._routeClasses[handlerName] = new (await import(`./handlers/${h}.js`))[handlerName](_router);
        }
    }
    app.use(_router.routes(), _router.allowedMethods())
}
