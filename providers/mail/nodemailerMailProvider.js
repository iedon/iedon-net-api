import { DefaultMailProvider } from "./defaultMailProvider.js";
import { createTransport } from "nodemailer";

export class NodemailerMailProvider extends DefaultMailProvider {
  constructor(app, mailSettings) {
    super(app, mailSettings);
  }

  async send(to, subject, content) {
    return new Promise((resolve, _) => {
      createTransport(this.mailSettings.nodemailer).sendMail(
        {
          from: this.mailSettings.senderEmailAddress,
          to,
          subject,
          text: "See HTML content",
          html: content,
        },
        (error, info) => {
          if (error) {
            if (this.mailSettings.logging) this.logger.error(error);
            resolve(false);
            return;
          }
          if (this.mailSettings.logging)
            this.logger.info(
              `Successfully sent mail to "${to}", subject: "${subject}", response: ${info.response}`
            );
          resolve(true);
        }
      );
    });
  }
}
