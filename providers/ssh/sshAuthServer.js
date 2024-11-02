export async function useSshAuthServer(app, sshAuthServerSettings = {}) {
  const providerName = sshAuthServerSettings.provider || 'default';
  const handlerName = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}SshAuthServerProvider`;
  const { [handlerName]: SshAuthServerProvider } = await import(`./${providerName}SshAuthServerProvider.js`);
  app.ssh = new SshAuthServerProvider(app, sshAuthServerSettings);
}