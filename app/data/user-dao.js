const crypto = require("crypto");
const { toCallback } = require("./mongo");
const { hashPassword, verifyPassword } = require("../password");

/* The UserDAO must be constructed with a connected database object */
function UserDAO(db) {

    "use strict";

    /* If this constructor is called without the "new" operator, "this" points
     * to the global object. Log a warning and call it correctly. */
    if (false === (this instanceof UserDAO)) {
        console.log("Warning: UserDAO constructor called without 'new' operator");
        return new UserDAO(db);
    }

    const usersCol = db.collection("users");

    // Driver 4.0 removed findAndModify(); driver 6.0 made findOneAndUpdate() resolve
    // to the document itself rather than { value: doc }.
    const nextSequence = name => db.collection("counters").findOneAndUpdate({
        _id: name
    }, {
        $inc: {
            seq: 1
        }
    }, {
        returnDocument: "after"
    }).then(counter => {
        if (!counter) {
            throw new Error(`Counter "${name}" not found; run artifacts/db-reset.js`);
        }
        return counter.seq;
    });

    this.addUser = (userName, firstName, lastName, password, email, callback) => {

        // Create user document
        const user = {
            userName,
            firstName,
            lastName,
            benefitStartDate: this.getRandomFutureDate()
        };

        // Add email if set
        if (email) {
            user.email = email;
        }

        // Driver 4.0 removed insert() and result.ops; insertOne() returns only insertedId,
        // so return the document we built (its _id comes from the counter).
        // Fix for A2 - Broken Authentication: store a salted scrypt hash, never the
        // password itself (app/password.js). The hash is not returned to the caller.
        const inserted = Promise.all([nextSequence("userId"), hashPassword(password)]).then(([id, hash]) => {
            user._id = id;
            return usersCol.insertOne({ ...user, password: hash });
        }).then(() => user);

        toCallback(inserted, callback);
    };

    this.getRandomFutureDate = () => {
        const today = new Date();
        const day = (Math.floor(Math.random() * 10) + today.getDay()) % 29;
        const month = (Math.floor(Math.random() * 10) + today.getMonth()) % 12;
        const year = Math.ceil(Math.random() * 30) + today.getFullYear();
        return `${year}-${("0" + month).slice(-2)}-${("0" + day).slice(-2)}`;
    };

    // A hash of a random value, compared against when the user name does not exist, so a
    // failed login takes about as long either way (no user enumeration by timing).
    let dummyHash;
    const getDummyHash = () => {
        dummyHash = dummyHash || hashPassword(crypto.randomBytes(16).toString("hex"));
        return dummyHash;
    };

    const loginError = (message, flag) => {
        const err = new Error(message);
        // Set an extra field so routes can tell this apart from a database error
        err[flag] = true;
        return err;
    };

    this.validateLogin = (userName, password, callback) => {
        // Fix for A2 - Broken Authentication: compare against the stored scrypt hash in
        // constant time. There is deliberately no plaintext fallback.
        // A JSON body could send {"userName": {"$ne": null}}; only strings are looked up.
        const lookup = typeof userName === "string" ? usersCol.findOne({ userName }) : Promise.resolve(null);

        const checked = lookup.then(user => {
            if (!user) {
                return getDummyHash()
                    .then(hash => verifyPassword(password, hash))
                    .then(() => { throw loginError("No such user", "noSuchUser"); });
            }
            return verifyPassword(password, user.password).then(ok => {
                if (!ok) throw loginError("Invalid password", "invalidPassword");
                return user;
            });
        });

        toCallback(checked, callback);
    };

    // This is the good one, see the next function
    this.getUserById = (userId, callback) => {
        toCallback(usersCol.findOne({
            _id: parseInt(userId)
        }), callback);
    };

    this.getUserByUserName = (userName, callback) => {
        toCallback(usersCol.findOne({
            userName: userName
        }), callback);
    };

    this.getNextSequence = (name, callback) => {
        toCallback(nextSequence(name), callback);
    };
}

module.exports = { UserDAO };
