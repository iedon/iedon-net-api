import { DefaultOpenAuthProvider } from "./defaultOpenAuthProvider";
import { readFile } from "fs";
import { createVerify } from "crypto";

export class KioubitOpenAuthProvider extends DefaultOpenAuthProvider {
  constructor(app, openAuthSettings) {
    super(app, openAuthSettings);

    this.isReady = false;
    readFile(this.openAuthSettings.publicKey, "utf8", (err, data) => {
      if (err) {
        this.logger.error(`Failed to read public key. ${err}`);
        return;
      }
      this.publicKey = data;
      this.isReady = true;
    });
  }

  authenticate(data) {
    const { params, signature } = data;
    if (!this.isReady || !params || !signature) return false;

    return this.verifyAuthToken(signature, params);
  }

  verifyAuthToken(signature, params) {
    try {
      // Decode parameters
      const paramBuffer = Buffer.from(params, "base64");
      const userData = JSON.parse(paramBuffer.toString("utf8"));

      // Verify timestamp
      const currentTime = Math.floor(Date.now() / 1000);
      if (Math.abs(userData.time - currentTime) > 60) return false;

      // Verify domain
      if (userData.domain !== this.openAuthSettings.myDomain) return false;

      // Create SHA-512 hash
      const verify = createVerify("SHA512");
      verify.update(params);
      verify.end();

      // Verify signature
      const isValid = verify.verify(
        this.publicKey,
        Buffer.from(signature, "base64")
      );
      if (!isValid) return false;

      // If authenticated user is not allowed to use external open auth, just refuse the request
      if (userData.asn) {
        for (let i = 0; i < this.openAuthSettings.notAllowed.length; i++) {
          if (this.openAuthSettings.notAllowed[i] === Number(userData.asn)) return false;
        }
      }

      return userData;
    } catch (error) {
      this.logger.error(`Failed to authenticate user. ${error}`);
      return false;
    }
  }
}
