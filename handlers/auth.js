import { BaseHandler } from "./base.js";
import { nullOrEmpty, signAsync, verifyAsync, getRandomCode, bcryptCompare, ASN_MIN, ASN_MAX, MAIL_REGEX } from "../common/helper.js";

import openpgp from 'openpgp';
import sshpk from 'sshpk';

/*
    "REQUEST": {
        "action": "query"
        "asn": "4242422189"
    },
    
    "RESPONSE": {
        "person": "iEdon",
        "authState": "1a2b3c4d5e6f",
        "availableAuthMethods": [
            {
                id: 0,
                type: "mail",
                name: "xxx@localhost.localdomain"
            },
            {
                id: 1,
                type: "pgp-fingerprint",
                name: "FINGERPRINT"
            },
            {
                id: 2,
                type: "ssh-xxx",
                name: "HASH....END"
            }
        ]
    },

    "REQUEST": {
        "action": "request",
        "authState": "1a2b3c4d5e6f",
        "authMethod": 0
    },

    "RESPONSE": {
        "authState": "6f5e4d3c2b1a",
        "authChallenge": "xxx@localhost.localdomain" | "encrypt this message with your key"
    },

    "REQUEST": {
        "action": "challenge"
        "authState": "6f5e4d3c2b1a",
        "data": "123456" | "====== PGP KEY ========"
    },

    "RESPONSE": {
        "authResult": true | false,
        "token": "ffffffffffffffffffffffffffffffffffff"
    }
*/

export class AuthHandler extends BaseHandler {

    constructor(router) {
        super(router);
        this.router.post('/auth', async (ctx, _) => {
            const action = ctx.request.body.action;
            switch (action) {
                case 'query': return await this.query(ctx);
                case 'request': return await this.request(ctx);
                case 'challenge': return await this.challenge(ctx);
                default: return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }
        });
    }

    checkAsn(asn) {
        if (nullOrEmpty(asn)) return false;
        const _asn = Number(asn);
        if (isNaN(_asn) || _asn < ASN_MIN || _asn > ASN_MAX) return false;
        return true;
    }

    async query(ctx) {
        if (!this.checkAsn(ctx.request.body.asn)) return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        const asn = String(ctx.request.body.asn).trim();

        let availableAuthMethods = [];
        const addAuthMethods = element => {
            if (!availableAuthMethods.some(entry => entry.type === element.type && entry.data === element.data)) {
                availableAuthMethods.push(element);
            }
        }

        const originalHash = await ctx.models.peerPreferences.findOne({
            attributes: [ 'password' ],
            where: {
                asn: Number(asn)
            }
        });

        if (originalHash && originalHash.dataValues.password) addAuthMethods({
            id: availableAuthMethods.length,
            type: 'password'
        });

        let person = '';
        const asnWhois = await ctx.app.whois.lookup(`AS${asn}`);
        if (asnWhois && !nullOrEmpty(asnWhois.adminC) && typeof asnWhois.adminC === 'string')
        {
            // Scan admin-c person
            const adminCWhois = await ctx.app.whois.lookup(asnWhois.adminC);
            if (adminCWhois) {

                if (!nullOrEmpty(adminCWhois.person) && typeof adminCWhois.person === 'string') person = adminCWhois.person.trim();

                if (ctx.app.settings.mailSettings.enableLoginByMail) {
                    // Scan entry 'contact' in admin-c for e-mail address
                    const possibleEmailEntries = [ 'contact', 'eMail', 'mail' ];
                    possibleEmailEntries.forEach(key => {
                        if (!nullOrEmpty(adminCWhois[key]) && typeof adminCWhois[key] === 'string') {
                            const matches = adminCWhois[key].trim().toLowerCase().match(MAIL_REGEX);
                            if (matches) matches.forEach(mail => {
                                addAuthMethods({
                                    id: availableAuthMethods.length,
                                    type: 'e-mail',
                                    data:  mail
                                });
                            });
                        }
                    });
                }

                // Scan entry 'pgp-fingerprint' in admin-c for pgp-fingerprint
                if (!nullOrEmpty(adminCWhois['pgp-fingerprint']) && typeof adminCWhois['pgp-fingerprint'] === 'string') {
                    addAuthMethods({
                        id: availableAuthMethods.length,
                        type: 'pgp-fingerprint',
                        data:  adminCWhois['pgp-fingerprint'].trim().toLowerCase()
                    });
                }

                // Scan admin-c's mntner
                if (!nullOrEmpty(adminCWhois.mntBy) && typeof adminCWhois.mntBy === 'string') {
                    const mntByWhois = await ctx.app.whois.lookup(adminCWhois.mntBy);
                    if (mntByWhois) {
                        // Scan entry 'auth'
                        if (!nullOrEmpty(mntByWhois.auth) && typeof mntByWhois.auth === 'string') {
                            const splits = mntByWhois.auth.trim().split('\x20');
                            for (let i = 0; i < splits.length; i++) {  
                                try {
                                    const entry = splits[i].trim();
                                    if (entry === 'pgp-fingerprint') {
                                        addAuthMethods({
                                            id: availableAuthMethods.length,
                                            type: 'pgp-fingerprint',
                                            data:  splits[i + 1].trim().toLowerCase()
                                        });
                                        continue;
                                    }
                                    if (entry.startsWith('ssh-')) {
                                        addAuthMethods({
                                            id: availableAuthMethods.length,
                                            type: entry,
                                            data: splits[i + 1].trim()
                                        });
                                        continue;
                                    }
                                } catch {
                                    // Dismiss index out of bounds exception for irregular entries
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        }

        let authState = '';
        try {
            authState = await signAsync(
            {
                asn,
                person,
                availableAuthMethods
            },
            ctx.app.settings.authHandler.stateSignSecret,
            ctx.app.settings.authHandler.stateSignOptions);
        } catch (error) {
            availableAuthMethods = [];
            ctx.app.logger.getLogger('app').error(error);
        }
        return this.makeResponse(ctx, this.RESPONSE_CODE.OK, {
            person,
            authState,
            availableAuthMethods
        });
    }

    async request(ctx) {
        let authState = ctx.request.body.authState;
        let authMethod = ctx.request.body.authMethod;
        if (ctx.request.body.action !== 'request' ||
            nullOrEmpty(authState) || typeof authState !== 'string' ||
            nullOrEmpty(authMethod) || typeof authMethod !== 'number' ||
            authMethod < 0)
        {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        try {
            authState = await verifyAsync(authState, ctx.app.settings.authHandler.stateSignSecret, ctx.app.settings.authHandler.stateSignOptions);
            if (authMethod >= authState.availableAuthMethods.length) return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        } catch {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        for (let i = 0; i < authState.availableAuthMethods.length; i++) {
            if (authState.availableAuthMethods[i].id === authMethod) {
                authMethod = authState.availableAuthMethods[i];
                break;
            }
        }

        let authChallenge = '';
        authState.code = getRandomCode();
        if (authMethod.type === 'password') {
            authChallenge = authState.asn;
        } else if (authMethod.type === 'e-mail') {
            authChallenge = ctx.app.settings.mailSettings.senderEmailAddress;
            await ctx.app.mail.send(authMethod.data,
                'Authentication Code',
                `Hi ${authState.person || authState.asn},\r\nThis is your challenge code: ${authState.code}\r\n\r\nYou've received this mail because you are authenticating with us.\r\nDo not reply this mail. It is sent automatically.\r\n\r\nHave a nice day!\r\n`);
        } else if (authMethod.type === 'pgp-fingerprint' || authMethod.type.startsWith('ssh-')) {
            authChallenge = authState.code;
        }

        try {
            authState = await signAsync(
            {
                asn: authState.asn,
                person: authState.person,
                authMethod,
                code: authState.code
            },
            ctx.app.settings.authHandler.stateSignSecret,
            ctx.app.settings.authHandler.stateSignOptions);
        } catch (error) {
            authChallenge = '';
            ctx.app.logger.getLogger('app').error(error);
        }

        if (authChallenge === '') authState = '';
        return this.makeResponse(ctx, this.RESPONSE_CODE.OK, {
            authState,
            authChallenge
        });
    }

    async challenge(ctx) {
        let authState = ctx.request.body.authState;
        const authData = ctx.request.body.data;
        if (ctx.request.body.action !== 'challenge' ||
            nullOrEmpty(authState) || typeof authState !== 'string')
        {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        try {
            authState = await verifyAsync(authState, ctx.app.settings.authHandler.stateSignSecret, ctx.app.settings.authHandler.stateSignOptions);
        } catch {
            return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
        }

        let authResult = false;
        let token = '';
        const type = authState.authMethod.type;
        const code = authState.code;

        if (type === 'password') {

            if (nullOrEmpty(authData) || typeof authData !== 'string') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            const rawPassword = authData.trim();
            try {
                const hash = await ctx.models.peerPreferences.findOne({
                    attributes: [ 'password' ],
                    where: {
                        asn: Number(authState.asn)
                    }
                });
                if (await bcryptCompare(rawPassword, hash.dataValues.password)) authResult = true;
            } catch (error) {
                ctx.app.logger.getLogger('app').error(error);
            }

        } else if (type === 'e-mail') {

            if (nullOrEmpty(authData) || typeof authData !== 'string') return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            if (authData.trim() === code) authResult = true;

        } else if (type === 'pgp-fingerprint') {

            if (!authData || !authData.publicKey || typeof authData.publicKey !== 'string' ||
                !authData.signedMessage || typeof authData.signedMessage !== 'string' ||
                authData.signedMessage.indexOf(code) === -1)
            {
                return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }

            try {
                const publicKey = await openpgp.readKey({
                    armoredKey: authData.publicKey.trim()
                });
                if (publicKey.getFingerprint() !== authState.authMethod.data) throw new Error('Invalid public key');

                const signedMessage = await openpgp.readCleartextMessage({
                    cleartextMessage: authData.signedMessage.trim()
                });
                const { verified } = (await openpgp.verify({
                    message: signedMessage,
                    verificationKeys: publicKey
                })).signatures[0];

                authResult = await verified; // throws on invalid signature

            } catch {
                // supress invalid signature exception
            }

        } else if (type.startsWith('ssh-')) {

            if (nullOrEmpty(authData) || typeof authData !== 'string' || authData.indexOf(code) === -1) {
                return this.makeResponse(ctx, this.RESPONSE_CODE.BAD_REQUEST);
            }

            try {
                const key = sshpk.parseKey(`${authState.authMethod.type} ${authState.authMethod.data}`, 'ssh');
                const publicKey = await openpgp.readKey({
                    armoredKey: key.toString('pkcs8')
                });

                const signedMessage = await openpgp.readCleartextMessage({
                    cleartextMessage: authData.signedMessage.trim()
                });
                const { verified } = (await openpgp.verify({
                    message: signedMessage,
                    verificationKeys: publicKey
                })).signatures[0];

                authResult = await verified; // throws on invalid signature
            } catch {
                // Supress invalid key or signature excpetions
            }
        }

        if (authResult) token = await ctx.app.token.generateToken({
            asn: authState.asn,
            person: authState.person
        });

        // This is special case we should manually append token to body because this route('/path') will not pass through core middleware.
        // And this is the first time the user gets a token
        this.makeResponse(ctx, this.RESPONSE_CODE.OK, { authResult });
        Object.assign(ctx.body, { token });
    }
}
