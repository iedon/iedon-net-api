import { readFile } from 'fs';
import { timingSafeEqual } from 'crypto';
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

  loadKeys() {
    return new Promise((resolve, reject) => {
      this.hosyKeys = [];
      for (const path of this.sshAuthServerSettings.ssh2.hostKeysPath) {
        readFile(path, 'utf-8', (err, data) => {
          if (err) reject(err);
          const _data = data.trim();
          if (_data) this.hosyKeys.push(_data);
          resolve();
        });
      }
    });
  }

  addAuthInfo(asn, publicKey, challengeText) {
    try {
      this.authInfo.set(asn, {
        publicKey: ssh2.utils.parseKey(publicKey),
        challengeText
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  removeAuthInfo(asn) {
    this.authInfo.delete(asn);
  }

  startServer() {
    const checkValue = (input, allowed) => {
      const autoReject = (input.length !== allowed.length);
      if (autoReject) {
        // Prevent leaking length information by always making a comparison with the
        // same input when lengths don't match what we expect ...
        allowed = input;
      }
      const isMatch = timingSafeEqual(input, allowed);
      return (!autoReject && isMatch);
    };

    const sshServer = new ssh2.Server({
      hostKeys: this.hosyKeys
    }, client => {
      let authenticated = null;
      let accepted = false;
      client.on('authentication', ctx => {
        if (accepted) return ctx.accept();

        if (ctx.method === 'publickey') {
          for (const [k, v] of this.authInfo) {
            try {
              if (ctx.key.algo === v.publicKey.type &&
                checkValue(ctx.key.data, v.publicKey.getPublicSSH())) {
                if (ctx.signature) {
                  if (!allowedPubKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) return ctx.reject();
                }
                authenticated = { ...v };
                this.authInfo.delete(k);
                this.logger.info(`Authentication successful(${k}) with method: ${ctx.method}, algorithm: ${ctx.key.algo}, service: ${ctx.service}`);
                accepted = true;
                return ctx.accept();
              }
            } catch (error) {
              this.logger.error(error);
              return ctx.reject();
            }
          }
        }

        return ctx.reject();
      })
        .on('ready', () => {
          client.on('session', acceptSession => {
            const session = acceptSession();
            session.once('shell', acceptShell => {
              const stream = acceptShell();
              stream.write('\r\n');
              stream.write('========================================\r\n');
              stream.write('Welcome to the SSH Auth Server!\r\n');
              stream.write('========================================\r\n');
              stream.write('\r\n\r\n');
              stream.write(authenticated ? `>> Your challenge code is:\r\n\t${authenticated.challengeText}\r\n\r\n` : '>> You have nothing to do here.\r\n\r\n');
              stream.write('\r\n');
              stream.write('* Type \"q\" to quit.\r\n\r\n');
              stream.write(`* The challenge code can only be used once.\r\n  It changes each time you authenticate with us.\r\n\r\n`);
              stream.write('* Copy the code and continue to sign in, \r\n\r\n');

              stream.on('data', data => {
                const input = data.toString().trim().toLowerCase();
                if (input === 'q' || input === 'quit' || input === 'exit') disconnect();
              });

              let tick = 10; // this.sshAuthServerSettings.ssh2.timeoutSeconds;
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
                authenticated = null;
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
