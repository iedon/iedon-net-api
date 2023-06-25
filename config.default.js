/**
 * ===========================
 *        IEDON-PEERAPI       
 *        Configutation       
 * ===========================
 */

export default {

    listenPort: 3000,

    handlers: [ 'admin', 'auth', 'list', 'ping', 'session', 'settings' ],

    loggerSettings: {
        provider: 'log4js',
        log4js: {
            appenders: {
                stdout: {
                    type: 'stdout'
                },
                app: {
                    type: 'dateFile',
                    filename: './logs/app/app.log',
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                },
                acorle: {
                    type: 'dateFile',
                    filename: './logs/acorle/acorle.log',
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                },
                mail: {
                    type: 'dateFile', 
                    filename: './logs/mail/mail.log', 
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                },
                whois: {
                    type: 'dateFile', 
                    filename: './logs/whois/whois.log', 
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                },
                fetch: {
                    type: 'dateFile', 
                    filename: './logs/fetch/fetch.log', 
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                },
                auth: {
                    type: 'dateFile', 
                    filename: './logs/auth/auth.log', 
                    compress: true,
                    numBackups: 7,
                    keepFileExt: true
                }
            },
            categories: {
                default: {
                    level: 'info',
                    appenders: [ 'stdout' ]
                },
                app: {
                    level: 'info',
                    appenders: [ 'app' ]
                },
                acorle: {
                    level: 'info',
                    appenders: [ 'acorle' ]
                },
                database: {
                    level: 'debug',
                    appenders: [ 'stdout' ]
                },
                mail: {
                    level: 'info',
                    appenders: [ 'mail' ]
                },
                whois: {
                    level: 'info',
                    appenders: [ 'whois' ]
                },
                fetch: {
                    level: 'info',
                    appenders: [ 'fetch' ]
                },
                auth: {
                    level: 'info',
                    appenders: [ 'auth' ]
                }
            }
        }
    },

    // Integration with acorle microservice
    acorle: {
        enabled: false,
        zone: 'dev',
        secret: '',
        regIntervalSeconds: 30,
        centerServerUrl: 'http://',
        localUrl: 'http://',
        // To configure which configuration we will use, from center server via acorle, or configuration presented below
        retriveConfigFromCenterServer: true,
        configKey: 'peerapi_config',
        serviceKey: 'peerapi',
        serviceName: 'iEdon PeerAPI'
    },

    // ** The following configutations can be retrived via acorle **
    authHandler: {
        stateSignSecret: '__DEMO__STATE_SIGN_SECRET__',
        stateSignOptions: {
            algorithm: 'HS256',
            expiresIn: '10m'    // where sign-in state(via mail, pgp, ssh) expires
        }
    },

    dbSettings: {
        dialect: 'mysql', /* sqlite */
        storage: '', /* for sqlite */
        host: 'localhost',
        port: 3306,
        user: '',
        password: '',
        database: 'iedon-peerapi',
        pool: {
            max: 5,
            min: 1,
            idle: 10000
        },
        logging: true,
        dialectOptions: {}
    },

    mailSettings: {
        enableLoginByMail: false,
        provider: 'default',    // change to nodemailer to use smtp and fill configuration section bellow
        senderEmailAddress: 'dn42@localhost.localdomain',
        logging: true,
        nodemailer: {
            host: 'smtp.localhost.localdomain',
            port: 465,
            secure: true,
            auth: {
                user: '',
                pass: ''
            }
        },
        acorle: {               // configuration for acorle mail provider(via microservice)
            serviceKey: 'dn42_send_mail'      // service key for RPC
        }
    },

    whoisSettings: {
        provider: 'default',    // default provider is using whois-json package and takes whois configuration section bellow
        logging: true,
        whois: {
            server:  'whois.dn42',        // this can be a string ("host:port") or an object with host and port as its keys; leaving it empty makes lookup rely on servers.json
            follow:  2,         // number of times to follow redirects
            timeout: 10000,         // socket timeout, excluding this doesn't override any default timeout value
            verbose: false,     // setting this to true returns an array of responses from all servers
            bind: null,         // bind the socket to a local IP address
            // proxy: {            // (optional) SOCKS Proxy
            //     host: "",
            //     port: 0,
            //     type: 5         // or 4
            // }
        },
        acorle: {               // configuration for acorle whois provider(via microservice)
            serviceKey: 'dn42_whois'      // service key for RPC
        }
    },

    fetchSettings: {
        provider: 'default',    // default provider is using urllib package and takes fetch configuration section bellow
        logging: true,
        fetch: {
            options: {
                timeout: 10000,
                cache: 'no-cache',
                headers: {
                    'User-Agent': 'iEdon-PeerAPI'
                },
            }
        },
    },

    tokenSettings: {
        provider: 'default',    // default provider is using jsonwebtoken package and takes jwt configuration section bellow
        logging: true,
        jwt: {
            secret: '__DEMO_SECRET_IEDON_PEERAPI__',
            options: {
                algorithm: 'HS256',
                expiresIn: '5m'
            }
        },
        acorle: {               // configuration for acorle auth provider(via microservice)
            serviceKey: 'dn42_token'      // service key for RPC
        }
    },

    // Configure CORS headers and your custom headers here
    corsHeaders: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-PINGOTHER, Content-Type',
    },

    customHeaders: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'X-PeerAPI-Version, Content-Type',
        'Access-Control-Max-Age': '86400',
        'X-Powered-By': 'PHP/8.2.6'
    }
}
