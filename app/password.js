"use strict";

// Password hashing (fix for A2 - Broken Authentication). Upstream NodeGoat stored and
// compared passwords in plaintext; its commented-out fix used bcrypt-nodejs, which has
// been unmaintained since 2013. This uses Node's built-in scrypt (a memory-hard key
// derivation function), so there is no extra dependency.
//
// Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// Parameters are kept in the stored value, so they can be raised later without
// breaking existing hashes.

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt's cost does not depend on input length, but there is no reason to accept
// megabyte "passwords" in a request body.
const MAX_PASSWORD_LENGTH = 1024;

const derive = (password, salt, { N, r, p }) =>
    scrypt(String(password), salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });

const hashPassword = async password => {
    if (String(password).length > MAX_PASSWORD_LENGTH) throw new Error("Password too long");
    const salt = crypto.randomBytes(SALT_LENGTH);
    const hash = await derive(password, salt, PARAMS);
    return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
};

// Resolves true only for a well-formed scrypt hash of this password. Anything else,
// including a plaintext value left over from upstream seed data, is a mismatch.
const verifyPassword = async (password, stored) => {
    const parts = String(stored || "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    if (String(password).length > MAX_PASSWORD_LENGTH) return false;

    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (![N, r, p].every(Number.isInteger)) return false;

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    const actual = await derive(password, salt, { N, r, p });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

module.exports = { hashPassword, verifyPassword };
