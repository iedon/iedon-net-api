import { readFile } from 'fs';
import ssh2 from 'ssh2';

export class DefaultSshAuthServerProvider {
  constructor(app, sshAuthServerSettings) {
    this.app = app;
    this.sshAuthServerSettings = sshAuthServerSettings;
    this.logger = this.app.logger.getLogger('ssh');

    this.hosyKeys = [];
    this.authInfo = new Map();

    this.loadKeys().then(() => {
      this.sshServer = this.startServer();
    }).catch(err => {
      this.logger.error(err);
    });
  }

  readFileAsync(path) {
    return new Promise((resolve, reject) => {
      readFile(path, 'utf-8', (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        if (data === undefined) {
          reject(`File is empty or unable to read: ${path}`);
          return;
        }
        resolve(data);
      });
    });
  }

  loadKeys() {
    return new Promise(async resolve => {
      this.hosyKeys = [];
      for (const path of this.sshAuthServerSettings.ssh2.hostKeysPath) {
        try {
          const data = (await this.readFileAsync(path)).trim();
          if (data) this.hosyKeys.push(data);
        } catch (error) {
          this.logger.error(error);
        }
      }
      resolve();
    });
  }

  setSshAuthInfo(asn, publicKey, challengeText) {
    /*
     <'publicKey', {
      parsed: parsedKey
      asnMap: <'asn', {
        'challengeText',
        date
      }>
     }>
    */
    try {
      const split = publicKey.split('\x20');
      const trimmed = `${split[0].toLowerCase()} ${split[1]}`;
      let obj = this.authInfo.get(trimmed);
      if (!obj) {
        obj = {
          parsed: ssh2.utils.parseKey(publicKey),
          asnMap: new Map()
        };
        this.authInfo.set(trimmed, obj);
      }
      obj.asnMap.set(asn, {
        challengeText,
        date: +new Date()
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  clearSshAuthInfo(asn, publicKey) {
    try {
      const split = publicKey.split('\x20');
      const trimmed = `${split[0].toLowerCase()} ${split[1]}`;
      const obj = this.authInfo.get(trimmed);
      if (obj && obj.asnMap.has(asn)) obj.asnMap.delete(asn);
    } catch (error) {
      this.logger.error(error);
    }
  }

  startServer() {
    const sshServer = new ssh2.Server({
      hostKeys: this.hosyKeys
    }, client => {
      let asnMap = null;
      let accepted = false;
      client.on('authentication', ctx => {
        try {
          if (accepted) return ctx.accept();

          if (ctx.method === 'publickey') {
            const publicKey = ctx.key.data.toString('base64');
            const obj = this.authInfo.get(`${ctx.key.algo.toLowerCase()} ${publicKey}`);
            if (obj) {
              if (ctx.signature &&
                !obj.parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo)
              ) {
                return ctx.reject(['publickey']);
              }
              asnMap = obj.asnMap;
              accepted = true;
              return ctx.accept();
            }
          }
        } catch (error) {
          this.logger.error(error);
        }
        return ctx.reject(["publickey"]);
      })
        .on('ready', () => {
          client.on('session', acceptSession => {
            const session = acceptSession();
            session.once('shell', acceptShell => {
              const stream = acceptShell();
              stream.write('\r\n');
              this.sshAuthServerSettings.ssh2.bannerText.forEach(t => {
                stream.write(`${t}\r\n`);
              });

              stream.write('\r\n\r\n');

              let found = false;
              for (const [asn, obj] of asnMap) {
                found = true;
                if (obj) {
                  stream.write(`>> Challenge code for AS${asn} is:\r\n\t\x1b[1m${obj.challengeText}\x1b[0m\r\n`);
                  stream.write(`   Last request date: ${new Date(obj.date).toUTCString()}\r\n\r\n`);
                } else {
                  stream.write(`>> AS${asn} has nothing to do here.\r\n\r\n`);
                }
              }
              if (!found) stream.write(`>> You have nothing to do here.\r\n\r\n`);

              stream.write('\r\n');
              stream.write('* Type \"q\" to quit.\r\n\r\n');
              stream.write(`* The challenge code can only be used once.\r\n  It changes each time you authenticate with us.\r\n\r\n`);
              stream.write('* Copy the code and continue to sign in, \r\n\r\n');

              stream.on('data', data => {
                const input = data.toString().trim().toLowerCase();
                if (input === 'q' || input === 'quit' || input === 'exit') disconnect();
              });

              let tick = this.sshAuthServerSettings.ssh2.timeoutSeconds;
              let intervalHandler = null;
              const disconnect = () => {
                if (intervalHandler) {
                  clearInterval(intervalHandler);
                  intervalHandler = null;
                }
                if (!stream.closed) {
                  stream.exit(0);
                  stream.end();
                  stream.close();
                }
                asnMap = null;
              };

              const countDown = () => {
                if (tick === 0) disconnect();
                if (!stream.closed) stream.write(`\x1b[1A\x1b[K  or session will be closed in \x1b[1m${--tick}\x1b[0m seconds.\r\n`);
              };
              countDown();
              intervalHandler = setInterval(countDown, 1000);
            }).once('pty', acceptPty => {
              acceptPty();
            })
          });
        });
    }).on('error', err => {
      this.logger.error(err);
    });

    if (this.sshAuthServerSettings.ssh2.listen.type === 'unix') {
      sshServer.listen(this.sshAuthServerSettings.ssh2.listen.path, () => {
        this.logger.info(`SSH Server is listening on: unix:${this.sshAuthServerSettings.ssh2.listen.path}`);
      });
    } else if (this.sshAuthServerSettings.ssh2.listen.type === 'tcp') {
      sshServer.listen(this.sshAuthServerSettings.ssh2.listen.port, this.sshAuthServerSettings.ssh2.listen.hostname, () => {
        this.logger.info(`SSH Server is listening on tcp://${this.sshAuthServerSettings.ssh2.listen.hostname}:${this.sshAuthServerSettings.ssh2.listen.port}`);
      });
    } else {
      this.logger.error(`Not supported listen type: ${this.sshAuthServerSettings.ssh2.listen.type}`);
    }

    this.sshServer = sshServer;
  }
}
