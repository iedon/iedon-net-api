export class DefaultFetchProvider {
  constructor(app, fetchSettings) {
    this.app = app;
    this.fetchSettings = fetchSettings;
    this.logger = this.app.logger.getLogger('fetch');
  }

  async send(url, options = {}, dataType = 'json') {
    const finalOptions = { ...options };
    Object.assign(finalOptions, this.fetchSettings.fetch.options || {});
    try {
      const response = await this._fetch(new URL(url), finalOptions);
      if (response.status !== 200 && this.fetchSettings.logging) {
        this.logger.warn(`[DefaultRequestProvider] Got HTTP Status ${response.status} for request ${url}`);
      }
      const result = {
        status: response.status
      };
      switch (dataType) {
        case 'json': result.data = await response.json(); break;
        case 'xml':
        case 'html':
        case 'text':
          result.data = await response.text();
          break;
        default: case 'blob': result.data = await response.blob(); break;
      };
      return result;
    } catch (error) {
      if (this.fetchSettings.logging) this.logger.error(error);
      return null;
    }
  }

  async get(url, dataType = 'json', options = {}) {
    const finalOptions = options;
    Object.assign(finalOptions, { method: 'GET' });
    return await this.send(url, finalOptions, dataType);
  }

  async post(url, data, dataType = 'json', options = {}) {
    let _data = data;
    if (dataType === 'json') {
      if (typeof _data !== 'string') _data = JSON.stringify(data);
    }
    const POST_OPTIONS = {
      method: 'POST',
      body: _data,
      header: {
        'Content-Type': this.getContentType(dataType)
      }
    };
    const finalOptions = options;
    Object.assign(finalOptions, POST_OPTIONS);
    return await this.send(url, finalOptions, dataType);
  }

  getContentType(dataType) {
    switch (dataType) {
      case 'json': return 'application/json';
      case 'html': return 'text/html';
      case 'text': return 'text/plain';
      case 'xml': return 'application/xml';
      case 'form': return 'application/x-www-form-urlencoded';
      default: case 'blob': return 'application/octet-stream';
    }
  }

  async _fetch(resource, options = {}) {
    const { timeout = 10000 } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);

    return response;
  }
}
