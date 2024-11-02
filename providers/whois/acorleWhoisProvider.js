import { DefaultWhoisProvider } from './defaultWhoisProvider';

export class AcorleWhoisProvider extends DefaultWhoisProvider {
  constructor(app, whoisSettings) {
    super(app, whoisSettings);
  }

  async lookup(domainName) {
    try {
      // TODO
      return (await this.app.acorle.requestPeerService(this.whoisSettings.acorle.serviceKey, domainName, 'POST', { 'Content-Type': 'text/plain' })).toString();
    } catch (error) {
      if (this.whoisSettings.logging) this.logger.error(error);
      return null;
    }
  }
}
