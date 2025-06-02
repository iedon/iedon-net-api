export async function useMail(app, mailSettings = {}) {
  const pn = `${mailSettings.provider || "default"}MailProvider`;
  const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);

  let perDay = 0,
    perHour = 0,
    perMinute = 0;
  app.mail = new (await import(`./${pn}.js`))[handlerName](app, mailSettings);
  if (typeof app.mail.send === "function") {
    const originalSend = app.mail.send;
    app.mail.send = async (to, subject, content) => {
      if (
        perDay >= mailSettings.limit.maxEmailsPerDay ||
        perHour >= mailSettings.limit.maxEmailsPerHour ||
        perMinute >= mailSettings.limit.maxEmailsPerMinute
      ) {
        app.logger
          .getLogger("mail")
          .warn(
            `Limit reached for sending emails. Current limit: Day(${mailSettings.limit.maxEmailsPerDay}), Hour(${mailSettings.limit.maxEmailsPerHour}), Minute(${mailSettings.limit.maxEmailsPerMinute})`
          );
        return false;
      }
      perDay++;
      perHour++;
      perMinute++;
      return await originalSend(to, subject, content);
    };
  }

  setInterval(() => {
    perMinute = 0;
  }, 1000 * 60);
  setInterval(() => {
    perHour = 0;
  }, 1000 * 60 * 60);
  setInterval(() => {
    perDay = 0;
  }, 1000 * 60 * 60 * 24);
}
