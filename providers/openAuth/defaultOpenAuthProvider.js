export class DefaultOpenAuthProvider {
  constructor(app, openAuthSettings) {
    this.app = app;
    this.openAuthSettings = openAuthSettings;
    this.logger = this.app.logger.getLogger('auth');
  }

  // return false or { asn: XXXXX, ...(customData) }
  authenticate(_) {
    this.logger.info('Dummy Open Auth used. Rejecting authentication request.');
    return false;
  }
}
