"use strict";

const _ = require("underscore");
const path = require("path");
const util = require("util");

const finalEnv = process.env.NODE_ENV || "development";

const allConf = require(path.resolve(__dirname + "/../config/env/all.js"));
const envConf = require(path.resolve(__dirname + "/../config/env/" + finalEnv.toLowerCase() + ".js")) || {};

const config = { ...allConf, ...envConf };

// Log the effective configuration with secret values redacted (threat T4: keep secrets out of logs).
const SECRET_KEYS = ["cookieSecret", "cryptoKey", "zapApiKey"];
const redacted = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, SECRET_KEYS.includes(key) && value ? "[REDACTED]" : value])
);
console.log(`Current Config:`);
console.log(util.inspect(redacted, false, null));

module.exports = config;
