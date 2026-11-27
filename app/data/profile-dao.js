const { toCallback } = require("./mongo");
const { encryptField, decryptField, isEncrypted } = require("../field-crypto");

/* The ProfileDAO must be constructed with a connected database object */
function ProfileDAO(db) {

    "use strict";

    /* If this constructor is called without the "new" operator, "this" points
     * to the global object. Log a warning and call it correctly. */
    if (false === (this instanceof ProfileDAO)) {
        console.log("Warning: ProfileDAO constructor called without 'new' operator");
        return new ProfileDAO(db);
    }

    const users = db.collection("users");

    // Fix for A6 - Sensitive Data Exposure: these fields are encrypted before they reach
    // MongoDB and decrypted only when the owner's profile is read (app/field-crypto.js).
    const SENSITIVE_FIELDS = ["ssn", "dob", "bankAcc", "bankRouting"];

    this.updateUser = (userId, firstName, lastName, ssn, dob, address, bankAcc, bankRouting, callback) => {

        // Create user document
        const user = {};
        if (firstName) {
            user.firstName = firstName;
        }
        if (lastName) {
            user.lastName = lastName;
        }
        if (address) {
            user.address = address;
        }
        if (bankAcc) {
            user.bankAcc = bankAcc;
        }
        if (bankRouting) {
            user.bankRouting = bankRouting;
        }
        if (ssn) {
            user.ssn = ssn;
        }
        if (dob) {
            user.dob = dob;
        }
        // Store the sensitive fields encrypted; the plaintext copy in `user` is only
        // returned to the route so the owner sees what they entered.
        const stored = { ...user };
        SENSITIVE_FIELDS.filter(field => field in stored).forEach(field => {
            stored[field] = encryptField(stored[field]);
        });

        toCallback(users.updateOne({
                _id: parseInt(userId)
            }, {
                $set: stored
            }),
            err => {
                if (!err) {
                    console.log("Updated user profile");
                    return callback(null, user);
                }

                return callback(err, null);
            }
        );
    };

    this.getByUserId = (userId, callback) => {
        toCallback(users.findOne({
                _id: parseInt(userId)
            }),
            (err, user) => {
                if (err) return callback(err, null);
                if (!user) return callback(null, user);

                SENSITIVE_FIELDS.filter(field => isEncrypted(user[field])).forEach(field => {
                    try {
                        user[field] = decryptField(user[field]);
                    } catch (decryptErr) {
                        // Tampered, or encrypted with a different CRYPTO_KEY: show nothing
                        // rather than a wrong value, and leave a trace in the log.
                        console.error(`Could not decrypt ${field} for user ${user._id}: ${decryptErr.message}`);
                        user[field] = "";
                    }
                });

                callback(null, user);
            }
        );
    };
}

module.exports = { ProfileDAO };
