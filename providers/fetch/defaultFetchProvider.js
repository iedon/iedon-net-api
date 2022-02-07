const urllib = require('urllib');

module.exports = class DefaultFetchProvider {
    constructor(app, fetchSettings) {
        this.app = app;
        this.fetchSettings = fetchSettings;
        this.logger = this.app.logger.getLogger('fetch');
    }

    async send(url, options={}) {
        const finalOptions = options;
        Object.assign(finalOptions, this.fetchSettings.urllib.options || {});
        try {
            const response = await urllib.request(url, finalOptions);
            if (response.status !== 200 && this.fetchSettings.logging) {
                this.logger.warn(`[DefaultRequestProvider] Got HTTP Status ${response.status} for request ${url}`);
            }
            return {
                status: response.status,
                data: response.data
            };
        } catch (error) {
            if (this.fetchSettings.logging) this.logger.error(error);
            return null;
        }
    }

    async get(url, dataType='json', options={}) {
        const finalOptions = options;
        Object.assign(finalOptions, { method: 'GET', dataType });
        return await this.send(url, finalOptions);
    }

    async post(url, data, dataType='json', options={}) {
        const POST_OPTIONS = {
            method: 'POST',
            data,
            dataType,
            contentType: dataType
        };
        const finalOptions = options;
        Object.assign(finalOptions, POST_OPTIONS);
        return await this.send(url, finalOptions);
    }
}
