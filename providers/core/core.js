import { makeResponse, RESPONSE_CODE } from "../../common/packet.js";
import { nullOrEmpty } from '../../common/helper.js';

export async function useCore(app, tokenSettings = {}) {
    const pn = `${tokenSettings.provider || 'default'}TokenProvider`;
    const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);
    app.token = new (await import(`./${pn}.js`))[handlerName](app, tokenSettings);

    app.use(async (ctx, next) => {

        ctx.set('X-Content-Type-Options', 'nosniff');
        ctx.set('X-Download-Options', 'noopen');
        ctx.set('X-Frame-Options', 'SAMEORIGIN');
        ctx.set('X-XSS-Protection', '1; mode=block');
        ctx.set('Pragma', 'no-cache');
        ctx.set('Cache-Control', 'no-store,no-cache');
        for (const header in app.settings.customHeaders) ctx.set(header, app.settings.customHeaders[header]);

        // Set CORS where request is a preflight
        if (ctx.request.method === 'OPTIONS') {
            for (const header in app.settings.corsHeaders) ctx.set(header, app.settings.corsHeaders[header]);
            ctx.status = 204;
            return;
        }

        if (ctx.request.method !== 'POST') return makeResponse(ctx, RESPONSE_CODE.METHOD_NOT_ALLOWED);

        // Skip token filter for public URLs
        if (ctx.request.url === '/auth' || ctx.request.url === '/list') return await next();

        // Verify token and set session state
        if (nullOrEmpty(ctx.request.body.token)) return makeResponse(ctx, RESPONSE_CODE.UNAUTHORIZED);
        const state = await app.token.verify(ctx.request.body.token);
        if (!state) return makeResponse(ctx, RESPONSE_CODE.UNAUTHORIZED);
        try {
            if (nullOrEmpty(state.asn)) return makeResponse(ctx, RESPONSE_CODE.SERVER_ERROR);
        } catch (error) {
            app.logger.getLogger('app').error(error);
            return makeResponse(ctx, RESPONSE_CODE.SERVER_ERROR);
        }
        ctx.state = state;

        await next();

        const nextToken = await ctx.app.token.generateToken({
            asn: state.asn,
            person: state.person
        });

        if (nextToken) Object.assign(ctx.body, {
            token: nextToken
        });

    });
}
