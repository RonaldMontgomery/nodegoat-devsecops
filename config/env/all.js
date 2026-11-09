// default app configuration
//
// Secrets are never stored in source control (Lab 2 / threat T4).
// SESSION_SECRET and CRYPTO_KEY are supplied at runtime from the environment:
//   - local: an ignored .env file (see .env.example)
//   - CI: generated per run, never stored
//   - cloud: AWS Secrets Manager, injected by the host at startup (planned)
// In production a missing secret stops startup instead of falling back to a default.
const crypto = require("crypto");

const port = process.env.PORT || 4000;
let db = process.env.MONGODB_URI || "mongodb://localhost:27017/nodegoat";

function requiredSecret(name) {
    const value = process.env[name];
    if (value) {
        return value;
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required secret ${name}; refusing to start in production`);
    }
    // Development/test only: a random per-process value, so no shared default exists.
    console.warn(`WARNING: ${name} not set; using a random per-process value (not for production)`);
    return crypto.randomBytes(32).toString("hex");
}

module.exports = {
    port,
    db,
    cookieSecret: requiredSecret("SESSION_SECRET"),
    cryptoKey: requiredSecret("CRYPTO_KEY"),
    cryptoAlgo: "aes256",
    hostName: "localhost",
    environmentalScripts: []
};
