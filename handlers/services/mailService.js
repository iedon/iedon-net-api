import { readFile } from "fs/promises";

let mailTemplate = null;
async function readTemplate(c) {
  if (!mailTemplate) {
    try {
      mailTemplate = await readFile(
        c.var.app.settings.mailSettings.templateFile,
        "utf8"
      );
    } catch (error) {
      c.var.app.logger
        .getLogger("mail")
        .error(`Error reading mail template. ${error}`);
    }
  }
  return mailTemplate;
}

export async function sendAuthMail(c, to, person, code) {
  const template = await readTemplate(c);
  if (!template) return false;

  const html = template
    .replaceAll("{{title}}", "iEdon DN42 Authentication")
    .replaceAll(
      "{{content}}",
      `<p>Hi ${person},</p>
      <p>Your challenge code is:</p>
      <div class="code">${code}</div>
      <p>
        You're receiving this email because you've initiated an authentication request.
        <br />
        Please do not reply - this message was sent automatically.
      </p>
      <p>Have a great day!</p>`
    );

  return await c.var.app.mail.send(to, "Your DN42 Authentication Code", html, {
    attachments: [
      {
        filename: "logo.png",
        path: "./logo.png",
        cid: "logo",
      },
    ],
  });
}
