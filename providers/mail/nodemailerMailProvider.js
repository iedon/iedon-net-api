const DefaultMailProvider = require('./defaultMailProvider')
const nodemailer = require('nodemailer');

module.exports = class NodemailMailProvider extends DefaultMailProvider {
    async send(to, subject, content) {
        return new Promise((resolve, _) => {
            nodemailer.createTransport(this.mailSettings.nodemailer).sendMail({
                from: this.mailSettings.senderEmailAddress,
                to,
                subject,
                text: content
            }, (error, info) => {
                if (error) {
                    if (this.mailSettings.logging) this.logger.error(error);
                    resolve(false);
                    return;
                }
                if (this.mailSettings.logging) this.logger.info(`Successfully sent mail to "${to}", subject: "${subject}", response: ${info.response}`)
                resolve(true);
            });
        });
    }
}
