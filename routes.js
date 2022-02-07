const router = require('koa-router')();

const loadedHandlers = [
    '/auth',
    '/list',
    '/settings',
    '/session',
    '/ping',
    '/admin'
];
loadedHandlers.forEach(handler => new (require(`./handlers${handler}Handler`))(router));

module.exports = router;
