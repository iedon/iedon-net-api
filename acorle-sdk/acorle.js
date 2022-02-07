'use strict';

const CryptoJS = require('crypto-js');
const urllib = require('urllib');

const ResponsePacket = require('./ResponsePacket_pb.js');
const RequestPacket = require('./RequestPacket_pb.js');
const RpcRequestOut = require('./RpcRequestOut_pb.js');
const RpcConfig = require('./RpcConfig_pb.js');
const ServiceProto = require('./ServiceProto_pb.js');
const HeaderKVPair = require('./HeaderKVPair_pb.js');

const ResponseCodeType = ResponsePacket.ResponsePacket.ResponseCodeType;
const AcorleActionEnum = RequestPacket.RequestPacket.ActionType;

const PACKET_MAGIC = new Uint8Array([ 0xAC, 0x02, 0x1E ]);
const verifyMagic = (magic1, magic2) => {
  if (magic1 === undefined || magic2 === undefined || magic1.length !== 3 || magic2.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (magic1[i] !== magic2[i]) return false;
  return true;
};
const ANTI_REPLAY_ALLOW_SECONDS_RANGE = 600;
const DEFAULT_REG_INTERVAL_SECONDS = 30;
const DEFAULT_CENTER_SERVER_URL = 'http://api.contoso.com';

const defaultHttpRequestFunc = async (url, options) => await urllib.request(url, options);
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

class AcorleService {
  constructor(key, url, name, isPrivate = true, weight = 1) {
    this.key = key;
    this.name = name;
    this.url = url;
    this.isPrivate = isPrivate;
    this.weight = weight;
  }
}

class AcorleClient {

  constructor(zone, secret, regIntervalSeconds = DEFAULT_REG_INTERVAL_SECONDS, centerServer = DEFAULT_CENTER_SERVER_URL, logFunc = defaultLogFunc, requestFunc = defaultHttpRequestFunc) {

    this.status = 'IDLE';
    this.antiReplayAllowSecondsRange = ANTI_REPLAY_ALLOW_SECONDS_RANGE;

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

  setAntiReplayAllowSecondsRange(antiReplayAllowSecondsRange) {
    this.antiReplayAllowSecondsRange = antiReplayAllowSecondsRange;
  }

  getMessageByCode(code) {
    switch (code) {
      case ResponseCodeType.OK:
        return 'OK';
      case ResponseCodeType.SERVER_EXCEPTION:
        return 'Server Error';
      case ResponseCodeType.NOT_FOUND:
        return 'Not Found';
      case ResponseCodeType.FORBIDDEN:
        return 'Forbidden';
      case ResponseCodeType.BAD_GATEWAY:
        return 'Bad Gateway';
      case ResponseCodeType.BAD_REQUEST:
        return 'Bad Request';
      case ResponseCodeType.SERVICE_UNAVAILABLE:
        return 'Service Unavailable';
      case ResponseCodeType.METHOD_NOT_ALLOWED:
        return 'Method Not Allowed';
      case ResponseCodeType.INVALID_BODY:
        return 'Invalid Body';
      case ResponseCodeType.RPC_INVALID_ZONE:
        return 'RPC: Invalid zone';
      case ResponseCodeType.RPC_OPERATION_FAILED:
        return 'RPC: Operation dailed';
      case ResponseCodeType.RPC_REG_LIMIT:
        return 'RPC: Could not register more services';
      case ResponseCodeType.RPC_RESPONSE_ERROR:
        return 'RPC: Response error';
      case ResponseCodeType.RPC_RESPONSE_TIMEDOUT:
        return 'RPC: Response timed out';
      case ResponseCodeType.RPC_NETWORK_EXCEPTION:
        return 'RPC: Network exception';
      case ResponseCodeType.RPC_CONFIG_NOT_FOUND:
        return 'RPC: Configuration not found';
      case ResponseCodeType.SVC_INVALID_ZONE:
        return 'Service: Invalid zone';
      case ResponseCodeType.SVC_NOT_FOUND_OR_UNAVAILABLE:
        return 'Service: Not found or unavailable';
      default:
        return 'Unknown';
    }
  }

  getSignature(timestamp) {
    return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(`${timestamp}${this.zone}${this.secret}`, `${timestamp}${this.zone}${this.secret}`));
  }

  makeRequestPacket(desiredAction, payload) {
    const packet = new RequestPacket.RequestPacket();
    packet.setMagic(PACKET_MAGIC);
    packet.setZone(this.zone);
    packet.setAction(desiredAction);
    packet.setData(payload);
    return packet.serializeBinary();
  }

  makeRpcRequestPacket(desiredAction, payload = null) {
    const timestamp_ms = +new Date();
    const packet = new RequestPacket.RequestPacket.RpcRequest();
    packet.setSignature(this.getSignature(timestamp_ms));
    packet.setTimestamp(timestamp_ms);
    if (payload != null) {
      if (payload instanceof Uint8Array) {
        packet.setData(payload);
      } else if (typeof payload === 'string') {
        packet.setData((new TextEncoder()).encode(payload));
      } else if (typeof payload === 'object') {
        packet.setData((new TextEncoder()).encode(JSON.stringify(payload)));
      } else {
        this.logFunc('warn', `Unsupported payload type: ${typeof payload}`);
      }
    }
    return this.makeRequestPacket(desiredAction, packet.serializeBinary());
  }

  makePublicRequestPacket(key, payload) {
    const packet = new RequestPacket.RequestPacket.ServiceRequest();
    packet.setKey(key);
    if (payload != null) {
      if (payload instanceof Uint8Array) {
        packet.setData(payload);
      } else if (typeof payload === 'string') {
        packet.setData((new TextEncoder()).encode(payload));
      } else if (typeof payload === 'object') {
        packet.setData((new TextEncoder()).encode(JSON.stringify(payload)));
      } else {
        this.logFunc('warn', `Unsupported payload type: ${typeof payload}`);
      }
    }
    return this.makeRequestPacket(AcorleActionEnum.SVC_REQUEST, packet.serializeBinary());
  }

  makePeerRequestPacket(key, payload = null) {
    const timestamp_ms = +new Date();
    const packet = new RpcRequestOut.RpcRequestOut();
    packet.setMagic(PACKET_MAGIC);
    packet.setSignature(this.getSignature(timestamp_ms));
    packet.setTimestamp(timestamp_ms);
    packet.setZone(this.zone);
    packet.setKey(key);
    if (payload != null) {
      if (payload instanceof Uint8Array) {
        packet.setData(payload);
      } else if (typeof payload === 'string') {
        packet.setData((new TextEncoder()).encode(payload));
      } else if (typeof payload === 'object') {
        packet.setData((new TextEncoder()).encode(JSON.stringify(payload)));
      } else {
        this.logFunc('warn', `Unsupported payload type: ${typeof payload}`);
      }
    }
    return packet.serializeBinary();
  }

  getRequestData(rawData) {
    let packet = null;
    try {
      packet = RpcRequestOut.RpcRequestOut.deserializeBinary(rawData);
    } catch {
      // this.logFunc('warn', 'Invalid request');
      throw new Error('InvalidRequestException');
    }
    const magic = packet.getMagic();
    const signature = packet.getSignature();
    const timestamp = packet.getTimestamp();
    const data = packet.getData();
    if (packet === null || signature === undefined
        || signature === null || timestamp === undefined
        || timestamp === null || data === undefined || data === null
        || !verifyMagic(magic, PACKET_MAGIC)
    ) {
      // this.logFunc('warn', 'Invalid request');
      throw new Error('InvalidRequestException');
    }
    const timestamp_ms = +new Date();
    const _signature = this.getSignature(timestamp);
    if (packet.getSignature() !== _signature) {
      this.logFunc('warn', `Request signature check failed: ${signature} !== compute: ${_signature}`);
      throw new Error('InvalidRequestException');
    }
    if (timestamp < timestamp_ms - this.antiReplayAllowSecondsRange * 1000 || timestamp > timestamp_ms + this.antiReplayAllowSecondsRange * 1000) {
      this.logFunc('warn', 'Invalid request: invalid timestamp');
      throw new Error('InvalidRequestException');
    }
    const remoteHeaders = {};
    packet.getHeadersList().forEach(h => {
      remoteHeaders[h.getKey()] = [];
      h.getValuesList().forEach(v => remoteHeaders[h.getKey()].push(v));
    });
    return {
      remoteIp: packet.getIp(),
      remotePort: packet.getPort(),
      remoteHeaders,
      data,
    };
  }

  makeResponsePacket(code, payload = null, headers = null) {
    const packet = new ResponsePacket.ResponsePacket();
    packet.setMagic(PACKET_MAGIC);
    packet.setCode(code);
    if (payload !== null) {
      if (payload instanceof Uint8Array) {
        packet.setData(payload);
      } else if (typeof payload === 'string') {
        packet.setData((new TextEncoder()).encode(payload));
      } else if (typeof payload === 'object') {
        packet.setData((new TextEncoder()).encode(JSON.stringify(payload)));
      } else {
        this.logFunc('warn', `Unsupported payload type: ${typeof payload}`);
      }
    }
    if (headers !== null && headers instanceof Map) {
      headers.forEach((values, key) => {
        const headerPair = new HeaderKVPair.HeaderKVPair();
        headerPair.setKey(key);
        values.forEach(v => headerPair.addValues(v));
        packet.addHeaders(headerPair);
      });
    }
    return packet.serializeBinary();
  }

  async sendRequest(requestBody) {
    const options = {
      method: 'POST',
      uri: this.centerServer,
      content: Buffer.from(requestBody),
      headers: { 'Content-Type': 'application/x-protobuf' },
    };
    const response = await this.requestFunc(`${this.centerServer}/rpc`, options);
    if (response.status !== 200) throw new Error(`HTTP Status ${response.status}`);
    let data = null;
    try {
      data = ResponsePacket.ResponsePacket.deserializeBinary(response.data);
    } catch {
      throw new Error('Invalid response received from center server.');
    }
    if (data === null) throw new Error('Invalid response received from center server.');
    const result = {
      magic: data.getMagic(),
      code: data.getCode(),
      headers: data.getHeadersList(),
      data: data.getData(),
    };
    if (!verifyMagic(result.magic, PACKET_MAGIC) || result.code === undefined || result.code === null || result.data === undefined || result.data === null) throw new Error('Invalid response received from center server.');
    return result;
  }

  async registerServices(services) {
    if (services.length === 0) return true;
    if (this.status !== 'REGISTERED') this.status = 'REGISTERING';

    this.services = services;
    const rpcRegisterServiceRequest = new RequestPacket.RequestPacket.RpcRequest.RpcRegisterServiceRequest();
    services.forEach(e => {
      const service = new RequestPacket.RequestPacket.RpcRequest.RpcRegisterServiceRequest.RegisterServiceElement();
      service.setKey(e.key.toLowerCase());
      service.setName(e.name);
      service.setUrl(e.url);
      service.setIsPrivate(e.isPrivate);
      service.setWeight(e.weight);
      rpcRegisterServiceRequest.addServices(service);
    });

    try {
      const parsedBody = await this.sendRequest(this.makeRpcRequestPacket(AcorleActionEnum.RPC_REGISTER, rpcRegisterServiceRequest.serializeBinary()));
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.status = 'REGISTER_FAILED';
        this.logFunc('error', `Failed to register services. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return false;
      }
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

    const rpcDestroyServiceRequest = new RequestPacket.RequestPacket.RpcRequest.RpcDestroyServiceRequest();
    keyUrlArray.forEach(e => {
      const destroyServiceElement = new RequestPacket.RequestPacket.RpcRequest.RpcDestroyServiceRequest.DestroyServiceElement();
      destroyServiceElement.setKey(e.key.toLowerCase());
      destroyServiceElement.setUrl(e.url);
      rpcDestroyServiceRequest.addServices(destroyServiceElement);
    });


    this.services = currentServices;
    try {
      const parsedBody = await this.sendRequest(this.makeRpcRequestPacket(AcorleActionEnum.RPC_DESTROY, rpcDestroyServiceRequest.serializeBinary()));
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to destroy services. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return false;
      }
      return true;
    } catch (err) {
      this.logFunc('error', `Failed to destroy services - ${err}`);
    }
    return false;
  }

  async listServices() {
    const requestPacket = this.makeRpcRequestPacket(AcorleActionEnum.RPC_LIST, '');
    try {
      const parsedBody = await this.sendRequest(requestPacket);
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to list services. Status : ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return null;
      }
      const serviceProto = ServiceProto.ServiceProto.deserializeBinary(parsedBody.data);
      const result = [];
      serviceProto.getServicesList().forEach(e => {
        result.push({
          hash: e.getHash(),
          key: e.getKey(),
          name: e.getName(),
          url: e.getUrl(),
          weight: e.getWeight(),
          isPrivate: e.getIsprivate(),
          addedTimestamp: e.getAddedtimestamp(),
          expireTimestamp: e.getExpiretimestamp(),
        });
      });
      return result;
    } catch (err) {
      this.logFunc('error', `Failed to list services - ${err}`);
    }
    return null;
  }

  async getService(serviceKey) {
    const rpcGetServiceRequest = new RequestPacket.RequestPacket.RpcRequest.RpcGetServiceRequest();
    rpcGetServiceRequest.setKey(serviceKey);
    const requestPacket = this.makeRpcRequestPacket(AcorleActionEnum.RPC_GET, rpcGetServiceRequest.serializeBinary());
    try {
      const parsedBody = await this.sendRequest(requestPacket);
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to get services. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return null;
      }
      const serviceProto = ServiceProto.ServiceProto.deserializeBinary(parsedBody.data);
      const result = [];
      serviceProto.getServicesList().forEach(e => {
        result.push({
          hash: e.getHash(),
          key: e.getKey(),
          name: e.getName(),
          url: e.getUrl(),
          weight: e.getWeight(),
          isPrivate: e.getIsprivate(),
          addedTimestamp: e.getAddedtimestamp(),
          expireTimestamp: e.getExpiretimestamp(),
        });
      });
      return result;
    } catch (err) {
      this.logFunc('error', `Failed to get services - ${err}`);
    }
    return null;
  }

  async callService(serviceKey) {
    const rpcCallServiceRequest = new RequestPacket.RequestPacket.RpcRequest.RpcCallServiceRequest();
    rpcCallServiceRequest.setKey(serviceKey);
    const requestPacket = this.makeRpcRequestPacket(AcorleActionEnum.RPC_CALL, rpcCallServiceRequest.serializeBinary());
    try {
      const parsedBody = await this.sendRequest(requestPacket);
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to call service. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return null;
      }
      if (parsedBody.data.length === 0) return '';
      return (new TextDecoder()).decode(parsedBody.data);
    } catch (err) {
      this.logFunc('error', `Failed to call service - ${err}`);
    }
    return null;
  }

  async getConfig(key, hash = null) {
    if (key === '') return null;
    const rpcGetConfigRequest = new RequestPacket.RequestPacket.RpcRequest.RpcGetConfigRequest();
    rpcGetConfigRequest.setKey(key);
    if (hash !== null) rpcGetConfigRequest.setHash(hash);
    const requestPacket = this.makeRpcRequestPacket(AcorleActionEnum.RPC_CONFIG_GET, rpcGetConfigRequest.serializeBinary());
    try {
      const parsedBody = await this.sendRequest(requestPacket);
      // if (parsedBody.code === ResponseCodeType.RPC_CONFIG_NOT_FOUND) return false;
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to get configuration. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return false;
      }
      const rpcConfigProto = RpcConfig.RpcConfigProto.deserializeBinary(parsedBody.data);
      return {
        zone: rpcConfigProto.getZone(),
        key: rpcConfigProto.getKey(),
        hash: rpcConfigProto.getHash(),
        context: rpcConfigProto.getContext(),
        lastModifiedTimestamp: rpcConfigProto.getLastmodifiedtimestamp(),
      };
    } catch (err) {
      this.logFunc('error', `Failed to get configuration - ${err}`);
    }
    return false;
  }

  async setConfig(key, context) {
    if (key === '') return null;
    const rpcSetConfigRequest = new RequestPacket.RequestPacket.RpcRequest.RpcSetConfigRequest();
    rpcSetConfigRequest.setKey(key);
    rpcSetConfigRequest.setContext(context);
    const requestPacket = this.makeRpcRequestPacket(AcorleActionEnum.RPC_CONFIG_SET, rpcSetConfigRequest.serializeBinary());
    try {
      const parsedBody = await this.sendRequest(requestPacket);
      if (parsedBody.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Failed to set configuration. Status: ${parsedBody.code} (${this.getMessageByCode(parsedBody.code)})`);
        return false;
      }
      return true;
    } catch (err) {
      this.logFunc('error', `Failed to set configuration - ${err}`);
    }
    return false;
  }

  async requestPeerService(key, payload) {
    const url = await this.callService(key.toLowerCase());
    if (url === undefined || url === null || url === '') return null;
    const peerRequestPacket = this.makePeerRequestPacket(key, payload);
    const options = {
      method: 'POST',
      content: Buffer.from(peerRequestPacket),
      headers: { 'Content-Type': 'application/x-protobuf' },
    };
    try {
      const response = await this.requestFunc(url, options);
      if (response.status !== 200) {
        this.logFunc('error', `Request service(${key}) failed from peer: HTTP Status ${response.status}`);
        return null;
      }
      const data = ResponsePacket.ResponsePacket.deserializeBinary(response.data);
      const result = {
        magic: data.getMagic(),
        code: data.getCode(),
        headers: data.getHeadersList(),
        data: data.getData(),
      };
      if (!verifyMagic(result.magic, PACKET_MAGIC) || result.code === undefined || result.code === null
          || result.data === undefined) {
        this.logFunc('error', `Request service(${key}) failed from peer: Peer Response Error`);
        return null;
      }
      if (result.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Request service(${key}) failed from peer: Status: ${result.code} (${this.getMessageByCode(result.code)})`);
        return null;
      }
      return result.data;
    } catch (err) {
      this.logFunc('error', `Request service(${key}) failed from peer - ${err}`);
      return null;
    }
  }

  async requestPublicService(key, payload = null) {
    if (key === undefined || key === null || key === '') return null;
    const options = {
      method: 'POST',
      content: Buffer.from(this.makePublicRequestPacket(key, payload)),
      headers: { 'Content-Type': 'application/x-protobuf' },
    };
    try {
      const response = await this.requestFunc(this.centerServer, options);
      if (response.status !== 200) {
        this.logFunc('error', `Request service(${key}) failed: HTTP Status ${response.status}`);
        return null;
      }
      const data = ResponsePacket.ResponsePacket.deserializeBinary(response.data);
      const result = {
        magic: data.getMagic(),
        code: data.getCode(),
        data: data.getData(),
      };
      if (!verifyMagic(result.magic, PACKET_MAGIC) || result.code === undefined || result.code === null
          || result.data === undefined) {
        this.logFunc('error', `Request service(${key}) failed: Response Error`);
        return null;
      }
      if (result.code !== ResponseCodeType.OK) {
        this.logFunc('error', `Request service(${key}) failed: ${result.code} (${this.getMessageByCode(result.code)})`);
        return null;
      }
      return result.data;
    } catch (err) {
      this.logFunc('error', `Request service(${key}) failed - ${err}`);
      return null;
    }
  }

}

module.exports = {
  AcorleClient,
  AcorleService,
  ResponseCodeType,
};

// /////////////////////////////
//      Ver. 2021/12/28       //
// /////////////////////////////
