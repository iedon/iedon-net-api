import { makeResponse, RESPONSE_CODE } from "../common/packet.js";
import { nullOrEmpty, signAsync, verifyAsync, getRandomCode, bcryptCompare, ASN_MIN, ASN_MAX, MAIL_REGEX } from "../common/helper.js";

import openpgp from 'openpgp';

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

export default async function (c) {
  const action = c.var.body.action;
  switch (action) {
    case 'query': return await query(c);
    case 'request': return await request(c);
    case 'challenge': return await challenge(c);
    default: return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }
}

const SupportedAuthType = {
  PASSWORD: 0,
  PGP_ASCII_ARMORED_CLEAR_SIGN: 1,
  SSH_SERVER_AUTH: 2,
  EMAIL: 3
};

function checkAsn(asn) {
  if (nullOrEmpty(asn)) return false;
  const _asn = Number(asn);
  if (isNaN(_asn) || _asn < ASN_MIN || _asn > ASN_MAX) return false;
  return true;
}

async function query(c) {
  if (!checkAsn(c.var.body.asn)) return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  const asn = String(c.var.body.asn).trim();

  let availableAuthMethods = [];
  const addAuthMethods = element => {
    if (!availableAuthMethods.some(entry => entry.type === element.type && entry.data === element.data)) {
      availableAuthMethods.push(element);
    }
  }

  const findAndAddAuthMethods = async (whoisData) => {
    const person = whoisData.person?.trim() || '';

    const addAuthMethod = (type, data) => {
      addAuthMethods({
        id: availableAuthMethods.length,
        type,
        data: type === SupportedAuthType.EMAIL ? data.trim().toLowerCase() : data.trim(),
      });
    };

    if (c.var.app.settings.mailSettings.enableLoginByMail) {
      const possibleEmailEntries = ['contact', 'e-mail', 'email', 'mail'];

      for (const key of possibleEmailEntries) {
        const values = Array.isArray(whoisData[key])
          ? whoisData[key]
          : whoisData[key]
            ? [whoisData[key]]
            : [];

        for (const value of values) {
          const matches = value.trim().toLowerCase().match(MAIL_REGEX);
          if (matches) matches.forEach((mail) => addAuthMethod(SupportedAuthType.EMAIL, mail));
        }
      }
    }

    const pgpFingerprints = Array.isArray(whoisData['pgp-fingerprint'])
      ? whoisData['pgp-fingerprint']
      : whoisData['pgp-fingerprint']
        ? [whoisData['pgp-fingerprint']]
        : [];

    pgpFingerprints.forEach(fingerprint => {
      if (fingerprint.trim()) {
        addAuthMethod(SupportedAuthType.PGP_ASCII_ARMORED_CLEAR_SIGN, fingerprint);
      }
    });

    const authEntries = Array.isArray(whoisData.auth)
      ? whoisData.auth
      : whoisData.auth
        ? [whoisData.auth]
        : [];

    for (const auth of authEntries) {
      const splits = auth.trim().split('\x20');

      for (let i = 0; i < splits.length; i++) {
        const entry = splits[i].trim();

        if (entry === 'pgp-fingerprint' && splits[i + 1]) {
          addAuthMethod(SupportedAuthType.PGP_ASCII_ARMORED_CLEAR_SIGN, splits[i + 1]);
          break;
        } else if (entry.includes('ssh') && splits[i + 1]) {
          addAuthMethod(SupportedAuthType.SSH_SERVER_AUTH, auth.trim());
          break;
        }
      }
    }

    return {
      person,
      adminC: whoisData['admin-c'],
      mntBy: whoisData['mnt-by'],
    };
  };

  const originalHash = await c.var.app.models.peerPreferences.findOne({
    attributes: ['password'],
    where: {
      asn: Number(asn)
    }
  });

  if (originalHash && originalHash.dataValues.password) addAuthMethods({
    id: availableAuthMethods.length,
    type: SupportedAuthType.PASSWORD
  });

  let _person = '';
  try {
    const asnWhois = await c.var.app.whois.lookup(`AS${asn}`);
    const { person, adminC, mntBy } = await findAndAddAuthMethods(parseWhois(asnWhois));
    _person = person;

    const _adminCArr = typeof adminC === 'string' ? [adminC] : Array.isArray(adminC) ? adminC : [];
    const _mntByArr = typeof mntBy === 'string' ? [mntBy] : Array.isArray(mntBy) ? mntBy : [];

    const lookup = async arr => {
      for (const item of arr) {
        const { person } = await findAndAddAuthMethods(parseWhois(await c.var.app.whois.lookup(item)));
        if (person) _person = person;
      }
    };

    // Run both lookups in parallel using Promise.all()
    await Promise.all([lookup(_adminCArr), lookup(_mntByArr)]);

  } catch (error) {
    c.var.app.logger.getLogger('app').error(`Error during ASN lookup or processing: ${error.message}`, error);
  }

  if (_person === '') _person = `AS${asn}`;

  let authState = '';
  try {
    authState = await signAsync(
      {
        asn,
        person: _person,
        availableAuthMethods
      },
      c.var.app.settings.authHandler.stateSignSecret,
      c.var.app.settings.authHandler.stateSignOptions);
  } catch (error) {
    availableAuthMethods = [];
    c.var.app.logger.getLogger('app').error(error);
  }
  return makeResponse(c, RESPONSE_CODE.OK, {
    person: _person,
    authState,
    availableAuthMethods
  });
}

async function request(c) {
  let authState = c.var.body.authState;
  let authMethod = c.var.body.authMethod;
  if (c.var.body.action !== 'request' ||
    nullOrEmpty(authState) || typeof authState !== 'string' ||
    nullOrEmpty(authMethod) || typeof authMethod !== 'number' ||
    authMethod < 0) {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  try {
    authState = await verifyAsync(authState, c.var.app.settings.authHandler.stateSignSecret, c.var.app.settings.authHandler.stateSignOptions);
    if (authMethod >= authState.availableAuthMethods.length) return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  } catch {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  for (let i = 0; i < authState.availableAuthMethods.length; i++) {
    if (authState.availableAuthMethods[i].id === authMethod) {
      authMethod = authState.availableAuthMethods[i];
      break;
    }
  }

  let authChallenge = '';
  authState.code = getRandomCode();
  if (authMethod.type === SupportedAuthType.PASSWORD) {
    authChallenge = authState.asn;
  } else if (authMethod.type === SupportedAuthType.EMAIL) {
    authChallenge = c.var.app.settings.mailSettings.senderEmailAddress;
    await c.var.app.mail.send(authMethod.data,
      'Authentication Code',
      `Hi ${authState.person || authState.asn},\r\nThis is your challenge code: ${authState.code}\r\n\r\nYou've received this mail because you are authenticating with us.\r\nDo not reply this mail. It is sent automatically.\r\n\r\nHave a nice day!\r\n`);
  } else if (authMethod.type === SupportedAuthType.PGP_ASCII_ARMORED_CLEAR_SIGN) {
    authChallenge = authState.code;
  } else if (authMethod.type === SupportedAuthType.SSH_SERVER_AUTH) {
    authChallenge = c.var.app.settings.sshAuthServerSettings.challengeHint || 'Connect to our server using SSH Client';
    c.var.app.ssh.addAuthInfo(authState.asn, authMethod.data.trim(), authState.code);
  }

  try {
    authState = await signAsync(
      {
        asn: authState.asn,
        person: authState.person,
        authMethod,
        code: authState.code
      },
      c.var.app.settings.authHandler.stateSignSecret,
      c.var.app.settings.authHandler.stateSignOptions);
  } catch (error) {
    authChallenge = '';
    c.var.app.logger.getLogger('app').error(error);
  }

  if (authChallenge === '') authState = '';
  return makeResponse(c, RESPONSE_CODE.OK, {
    authState,
    authChallenge
  });
}

async function challenge(c) {
  let authState = c.var.body.authState;
  const authData = c.var.body.data;
  if (c.var.body.action !== 'challenge' ||
    nullOrEmpty(authState) || typeof authState !== 'string') {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  try {
    authState = await verifyAsync(authState, c.var.app.settings.authHandler.stateSignSecret, c.var.app.settings.authHandler.stateSignOptions);
  } catch {
    return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
  }

  let authResult = false;
  let token = '';
  let authMethod = '';
  const type = authState.authMethod.type;
  const code = authState.code;

  if (type === SupportedAuthType.PASSWORD) {
    authMethod = 'password';
    if (nullOrEmpty(authData) || typeof authData !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    const rawPassword = authData.trim();
    try {
      const hash = await c.var.app.models.peerPreferences.findOne({
        attributes: ['password'],
        where: {
          asn: Number(authState.asn)
        }
      });
      if (await bcryptCompare(rawPassword, hash.dataValues.password)) authResult = true;
    } catch (error) {
      c.var.app.logger.getLogger('app').error(error);
    }

  } else if (type === SupportedAuthType.EMAIL) {
    authMethod = 'e-mail';
    if (nullOrEmpty(authData) || typeof authData !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    if (authData.trim() === code) authResult = true;

  } else if (type === SupportedAuthType.PGP_ASCII_ARMORED_CLEAR_SIGN) {
    authMethod = 'pgp';
    if (!authData || !authData.publicKey || typeof authData.publicKey !== 'string' ||
      !authData.signedMessage || typeof authData.signedMessage !== 'string') {
      return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    }

    if (authData.signedMessage.indexOf(code) !== -1) {
      try {
        const publicKey = await openpgp.readKey({
          armoredKey: authData.publicKey.trim()
        });
        if (publicKey.getFingerprint().toLowerCase() !== authState.authMethod.data.toLowerCase()) throw new Error('Invalid public key');

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
    }
  } else if (type === SupportedAuthType.SSH_SERVER_AUTH) {
    authMethod = 'ssh';
    if (nullOrEmpty(authData) || typeof authData !== 'string') return makeResponse(c, RESPONSE_CODE.BAD_REQUEST);
    if (authData.trim() === code) authResult = true;
  }

  if (authResult) {
    token = await c.var.app.token.generateToken({
      asn: authState.asn,
      person: authState.person
    });
    c.var.app.logger.getLogger('auth').info(`AS${asn} - Authentication successful via ${authMethod || '<Unknown>'}.`);
  }

  return makeResponse(c, RESPONSE_CODE.OK, { authResult, token });
}

function parseWhois(whoisText) {
  // Split the WHOIS text by new lines
  const lines = whoisText.split('\n');

  // Initialize an object to store the parsed data
  const parsedData = {};

  // Iterate through each line
  lines.forEach(line => {
    // Trim any leading/trailing whitespace
    line = line.trim();

    // Skip comments (lines starting with %)
    if (line.startsWith('%') || line === '') {
      return;
    }

    // Split the line into key and value by the first occurrence of ":"
    const [key, ...valueParts] = line.split(':');

    // Join the value parts back together and trim any extra spaces
    const value = valueParts.join(':').trim();

    // If the key already exists in the parsedData, convert it into an array (to handle multiple values for the same key)
    if (parsedData[key]) {
      if (Array.isArray(parsedData[key])) {
        parsedData[key].push(value);
      } else {
        parsedData[key] = [parsedData[key], value];
      }
    } else {
      parsedData[key] = value;
    }
  });

  return parsedData;
}
