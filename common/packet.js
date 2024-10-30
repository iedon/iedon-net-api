export const RESPONSE_CODE = {
    OK: 0,
    SERVER_ERROR: 1,
    UNAUTHORIZED: 2,
    BAD_REQUEST: 3,
    METHOD_NOT_ALLOWED: 4,
    ROUTER_OPERATION_FAILED: 5,
    ROUTER_NOT_AVAILABLE: 6
};

export function makeResponse(c, code, data) {
    let message = 'ok';
    switch (code) {
        default: case RESPONSE_CODE.OK: message = 'ok'; break;
        case RESPONSE_CODE.SERVER_ERROR: { message = 'server error'; ctx.status = 500; } break;
        case RESPONSE_CODE.UNAUTHORIZED: { message = 'unauthorized'; ctx.status = 401; } break;
        case RESPONSE_CODE.BAD_REQUEST: { message = 'bad request'; ctx.status = 400; } break;
        case RESPONSE_CODE.METHOD_NOT_ALLOWED: { message = 'method not allowed'; ctx.status = 405; ctx.set('Allow', 'POST'); } break;
        case RESPONSE_CODE.ROUTER_OPERATION_FAILED: message = 'router operation failed'; break;
        case RESPONSE_CODE.ROUTER_NOT_AVAILABLE: message = 'router not available'; break;
    };
    return c.json({
        code,
        message,
        data: data || ''
    });
}
