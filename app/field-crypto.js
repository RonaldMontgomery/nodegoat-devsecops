"use strict";

// Field-level encryption at rest (fix for A6 - Sensitive Data Exposure) for SSN, date
// of birth and bank details. Upstream NodeGoat's commented-out fix used AES-256-CBC with
// one IV stored in a module-level variable: every value shared the IV, it was lost on
// restart, and nothing detected tampering. This uses AES-256-GCM (authenticated) with a
// fresh random IV for every value, stored alongside the ciphertext.
//
// Stored format: enc:v1:<iv base64>:<auth tag base64>:<ciphertext base64>
// The key is derived from the CRYPTO_KEY secret (config.cryptoKey), which comes from the
// environment (Secrets Manager on the EC2 host) and never from source control.

const crypto = require("crypto");
const { cryptoKey } = require("../config/config");

const PREFIX = "enc:v1:";
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM
// Full 128-bit tag. Pinning the length on decrypt matters: otherwise Node accepts a
// truncated tag, and a short tag can be guessed, which allows forged ciphertexts.
const TAG_LENGTH = 16;

// HKDF turns the secret string into a 256-bit key bound to this one purpose.
const key = Buffer.from(crypto.hkdfSync("sha256", String(cryptoKey), "nodegoat", "profile-fields:v1", 32));

const isEncrypted = value => typeof value === "string" && value.startsWith(PREFIX);

const encryptField = plaintext => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [iv, tag, ciphertext].map(part => part.toString("base64")).join(":");
};

// Throws if the value was modified or encrypted with another key.
const decryptField = stored => {
    const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":").map(part => Buffer.from(part || "", "base64"));
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error("Malformed encrypted field");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

module.exports = { encryptField, decryptField, isEncrypted };
