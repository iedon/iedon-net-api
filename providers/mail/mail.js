export async function useMail(app, mailSettings={}) {
    const pn = `${mailSettings.provider || 'default'}MailProvider`;
    const handlerName = pn.charAt(0).toUpperCase() + pn.slice(1);
    app.mail = new (await import(`./${pn}.js`))[handlerName](app, mailSettings);
};
