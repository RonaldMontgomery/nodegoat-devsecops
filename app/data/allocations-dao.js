const UserDAO = require("./user-dao").UserDAO;
const { toCallback } = require("./mongo");

/* The AllocationsDAO must be constructed with a connected database object */
const AllocationsDAO = function(db){

    "use strict";

    /* If this constructor is called without the "new" operator, "this" points
     * to the global object. Log a warning and call it correctly. */
    if (false === (this instanceof AllocationsDAO)) {
        console.log("Warning: AllocationsDAO constructor called without 'new' operator");
        return new AllocationsDAO(db);
    }

    const allocationsCol = db.collection("allocations");
    const userDAO = new UserDAO(db);

    this.update = (userId, stocks, funds, bonds, callback) => {
        const parsedUserId = parseInt(userId);

        // Create allocations document
        const allocations = {
            userId: userId,
            stocks: stocks,
            funds: funds,
            bonds: bonds
        };

        // Driver 4.0 removed update(); a whole-document upsert is now replaceOne().
        // (The 2.x version also called back twice on success; this calls back once.)
        toCallback(allocationsCol.replaceOne({
            userId: parsedUserId
        }, allocations, {
            upsert: true
        }), err => {
            if (err) return callback(err, null);

            console.log("Updated allocations");

            userDAO.getUserById(userId, (err, user) => {

                if (err) return callback(err, null);

                // add user details
                allocations.userId = userId;
                allocations.userName = user.userName;
                allocations.firstName = user.firstName;
                allocations.lastName = user.lastName;

                return callback(null, allocations);
            });
        });
    };

    // Fix for A1 - 2 NoSQL Injection. The threshold used to be pasted into a $where
    // JavaScript string, so "1'; return 1 == '1" returned every user's allocations and
    // "0';while(true){}'" hung the database. It is now validated as a whole number from
    // 0 to 99 and used in a typed comparison; no server-side JavaScript runs.
    // Objects and arrays (e.g. ?threshold[$gt]=0) fail the string check.
    const THRESHOLD_RE = /^\d{1,2}$/;

    const invalidThreshold = () => {
        // Do not echo the input: allocations.html renders this with autoescape off.
        const err = new Error("Threshold must be a whole number from 0 to 99.");
        err.invalidThreshold = true;
        return err;
    };

    this.getByUserIdAndThreshold = (userId, threshold, callback) => {
        const parsedUserId = parseInt(userId);
        const hasThreshold = threshold !== undefined && threshold !== "";

        const searchCriteria = () => {
            if (!hasThreshold) {
                return {
                    userId: parsedUserId
                };
            }
            if (typeof threshold !== "string" || !THRESHOLD_RE.test(threshold)) {
                throw invalidThreshold();
            }
            return {
                userId: parsedUserId,
                stocks: {
                    $gt: parseInt(threshold, 10)
                }
            };
        };

        // Driver 5.0 removed callbacks, so toArray() and the per-user lookups are
        // promises. Promise.all also guarantees the callback runs exactly once.
        const findUser = id => new Promise((resolve, reject) => {
            userDAO.getUserById(id, (err, user) => err ? reject(err) : resolve(user));
        });

        // Running searchCriteria() inside then() turns a rejected threshold into a
        // rejected promise, so no query is sent to MongoDB.
        const findAllocations = () => allocationsCol.find(searchCriteria()).toArray();

        const userAllocations = Promise.resolve().then(findAllocations).then(allocations => {
            // A threshold that matches nothing is an empty result, not an error.
            if (!allocations.length && !hasThreshold) throw "ERROR: No allocations found for the user";

            return Promise.all(allocations.map(alloc => findUser(alloc.userId).then(user => {
                alloc.userName = user.userName;
                alloc.firstName = user.firstName;
                alloc.lastName = user.lastName;
                return alloc;
            })));
        });

        toCallback(userAllocations, callback);
    };

};

module.exports.AllocationsDAO = AllocationsDAO;
