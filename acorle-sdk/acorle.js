'use strict';

import jwt from 'jsonwebtoken';
const jwtSignAsync = (obj, secret, options) => new Promise((resolve, reject) => 
    jwt.sign(obj, secret, options, (error, token) => {
        if (error) {
            reject(error);
            return;
        }
        resolve(token);
    })
);

export const ResponseCodeType = {
  OK: 0,
  HTTP_EXCEPTION: 1,
  SERVER_EXCEPTION: 1000,
  NOT_FOUND: 1001,
  FORBIDDEN: 1002,
  BAD_GATEWAY: 1003,
  BAD_REQUEST: 1004,
  SERVICE_UNAVAILABLE: 1005,
  METHOD_NOT_ALLOWED: 1006,
  INVALID_BODY: 1007,
  UNAUTHORIZED: 1008,
  RPC_INVALID_ZONE: 2000,
  RPC_OPERATION_FAILED: 2001,
  RPC_REG_LIMIT: 2002,
  RPC_CONFIG_NOT_FOUND: 2003,
  RPC_GATEWAY_TIMEOUT: 2004,
  SVC_INVALID_ZONE: 3000,
  SVC_NOT_FOUND_OR_UNAVAILABLE: 3001
};

const AcorleActionEnum = {
  REGISTER: 'register',
  DESTROY: 'destroy',
  LIST: 'list',
  GET: 'get',
  SET: 'set',
  CALL: 'call'
};

const AcorleFieldEnum = {
  SERVICE: 'service',
  CONFIG: 'config'
}

const DEFAULT_REG_INTERVAL_SECONDS = 30;
const DEFAULT_CENTER_SERVER_URL = 'http://api.contoso.com';

const defaultHttpRequestFunc = async (url, options={}) => {
  const { timeout = 10000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(url, {
    ...options,
    signal: controller.signal  
  });
  clearTimeout(id);

  return response;
};

const defaultLogFunc = (level, log) => {
  switch (level) {
    case 'warn': return console.warn(log);
    case 'error': return console.error(log);
    case 'debug': return console.debug(log);
    case 'trace': return console.trace(log);
    case 'info': return console.info(log);
    default: case 'log': return console.log(log);
  }
}

export class AcorleService {
  constructor(key, url, name, isPrivate = true, weight = 1) {
    this.key = key;
    this.name = name;
    this.url = url;
    this.isPrivate = isPrivate;
    this.weight = weight;
  }
}

export class AcorleClient {

  constructor(zone, secret, regIntervalSeconds = DEFAULT_REG_INTERVAL_SECONDS, centerServer = DEFAULT_CENTER_SERVER_URL, logFunc = defaultLogFunc, requestFunc = defaultHttpRequestFunc) {

    this.status = 'IDLE';

    this.zone = zone;
    this.secret = secret;
    this.centerServer = centerServer;
    this.regIntervalSeconds = regIntervalSeconds
    this.services = [];

    this.requestFunc = requestFunc;
    this.logFunc = logFunc;

    setInterval(() => this.registerServices(this.services), this.regIntervalSeconds * 1000);
  }

  setRegIntervalSeconds(regIntervalSeconds) {
    this.regIntervalSeconds = regIntervalSeconds;
  }

  setCenterServer(centerServer) {
    this.centerServer = centerServer;
  }

  setZone(zone) {
    this.zone = zone;
  }

  setSecret(secret) {
    this.secret = secret;
  }

  setRequestFunc(requestFunc) {
    this.requestFunc = requestFunc;
  }

  setLogFunc(logFunc) {
    this.logFunc = logFunc;
  }

  async getSignature(timestamp) {
    return await jwtSignAsync({
      zone: this.zone,
      timestamp
    }, this.secret);
  }

  async sendRequest(field, action, requestBody) {
    const options = {
      method: 'POST',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${await this.getSignature(+new Date())}`
      },
    };
    if (requestBody) options.body = JSON.stringify(requestBody);
    const response = await this.requestFunc(`${this.centerServer}/rpc/${this.zone}/${field}/${action}`, options);
    try {
      const data = await response.json()
      if (response.status !== 200 || (data.code !== undefined && data.code !== null && data.code !== ResponseCodeType.OK)) {
        throw new Error(`HTTP Status: ${response.status}, RPC Status: ${data.code} (${data.message})`);
      }
      return data.data;
    } catch(e) {
      throw new Error(`Invalid response received from center server. ${e}`);
    }
  }

  async registerServices(services) {
    if (services.length === 0) return true;
    if (this.status !== 'REGISTERED') this.status = 'REGISTERING';

    this.services = services;
    const rpcRegisterServiceRequest = { services: [] }
    services.forEach(e => {
      rpcRegisterServiceRequest.services.push({
        key: e.key.toLowerCase(),
        name: e.name,
        url: e.url,
        isPrivate: e.isPrivate,
        weight: e.weight
      });
    });

    try {
      await this.sendRequest(AcorleFieldEnum.SERVICE, AcorleActionEnum.REGISTER, rpcRegisterServiceRequest);
      if (this.status !== 'REGISTERED') this.logFunc('info', `Status changed to REGISTERED. Registered services: ${services.length}`);
      this.status = 'REGISTERED';
      return true;
    } catch (err) {
      this.status = 'REGISTER_FAILED';
      this.logFunc('error', `Failed to register services - ${err}`);
    }
    return false;
  }

  async destroyServices(keyUrlArray) {
    const currentServices = [];
    this.services.forEach(e => {
      keyUrlArray.forEach(ex => {
        if (e.key !== ex.key && e.url !== ex.url) {
          currentServices.push(e);
        }
      });
    });

    const rpcDestroyServiceRequest = { services: [] };
    keyUrlArray.forEach(e => {
      rpcDestroyServiceRequest.services.push(      {
        key: e.key.toLowerCase(),
        url: e.url
      })
    });

    this.services = currentServices;
    try {
      await this.sendRequest(AcorleFieldEnum.SERVICE, AcorleActionEnum.DESTROY, rpcDestroyServiceRequest);
      return true;
    } catch (err) {
      this.logFunc('error', `Failed to destroy services - ${err}`);
    }
    return false;
  }

  async listServices() {
    try {
      const parsedBody = await this.sendRequest(AcorleFieldEnum.SERVICE, AcorleActionEnum.LIST);
      return parsedBody.services;
    } catch (err) {
      this.logFunc('error', `Failed to list services - ${err}`);
    }
    return [];
  }

  async getService(serviceKey) {
    try {
      const parsedBody = await this.sendRequest(AcorleFieldEnum.SERVICE, AcorleActionEnum.GET, { key: serviceKey });
      return parsedBody.services;
    } catch (err) {
      this.logFunc('error', `Failed to get services - ${err}`);
    }
    return [];
  }

  async callService(serviceKey) {
    try {
      const parsedBody = await this.sendRequest(AcorleFieldEnum.SERVICE, AcorleActionEnum.CALL, { key: serviceKey });
      return parsedBody;
    } catch (err) {
      this.logFunc('error', `Failed to call service - ${err}`);
    }
    return null;
  }

  async getConfig(key, hash = null) {
    if (key === '') return null;
    const rpcGetConfigRequest = {
      key
    };
    if (hash !== null) rpcGetConfigRequest.hash = hash;
    try {
      const parsedBody = await this.sendRequest(AcorleFieldEnum.CONFIG, AcorleActionEnum.GET, rpcGetConfigRequest);
      return parsedBody;
    } catch (err) {
      this.logFunc('error', `Failed to get configuration - ${err}`);
    }
    return false;
  }

  async setConfig(key, context) {
    if (key === '') return null;
    const rpcSetConfigRequest = {
      key,
      context
    };
    try {
      await this.sendRequest(AcorleFieldEnum.CONFIG, AcorleActionEnum.SET, rpcSetConfigRequest);
      return true;
    } catch (err) {
      this.logFunc('error', `Failed to set configuration - ${err}`);
    }
    return false;
  }

  async requestPeerService(key, payload, method=null, headers={}) {
    const url = await this.callService(key);
    if (url === undefined || url === null || url === '') return null;
    const options = {
      method: 'GET',
      headers,
    };
    if (payload != undefined && payload !== null) options.content = payload;
    if (method !== null) {
      if (payload != undefined && payload !== null) {
        options.method = 'POST';
      } else options.method = 'GET';
    }
    try {
      const response = await this.requestFunc(url, options);
      if (response.status !== 200) {
        this.logFunc('error', `Request service(${key}) failed from peer: HTTP Status ${response.status}`);
        return null;
      }
      return response.data;
    } catch (err) {
      this.logFunc('error', `Request service(${key}) failed from peer - ${err}`);
      return null;
    }
  }

}

// /////////////////////////////
//      Ver. 2023/06/16       //
// /////////////////////////////
