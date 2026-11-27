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

    this.getByUserIdAndThreshold = (userId, threshold, callback) => {
        const parsedUserId = parseInt(userId);

        const searchCriteria = () => {

            if (threshold) {
                /*
                // Fix for A1 - 2 NoSQL Injection - escape the threshold parameter properly
                // Fix this NoSQL Injection which doesn't sanitze the input parameter 'threshold' and allows attackers
                // to inject arbitrary javascript code into the NoSQL query:
                // 1. 0';while(true){}'
                // 2. 1'; return 1 == '1
                // Also implement fix in allocations.html for UX.                             
                const parsedThreshold = parseInt(threshold, 10);
                
                if (parsedThreshold >= 0 && parsedThreshold <= 99) {
                    return {$where: `this.userId == ${parsedUserId} && this.stocks > ${parsedThreshold}`};
                }
                throw `The user supplied threshold: ${parsedThreshold} was not valid.`;
                */
                return {
                    $where: `this.userId == ${parsedUserId} && this.stocks > '${threshold}'`
                };
            }
            return {
                userId: parsedUserId
            };
        };

        // Driver 5.0 removed callbacks, so toArray() and the per-user lookups are
        // promises. Promise.all also guarantees the callback runs exactly once.
        const findUser = id => new Promise((resolve, reject) => {
            userDAO.getUserById(id, (err, user) => err ? reject(err) : resolve(user));
        });

        const userAllocations = allocationsCol.find(searchCriteria()).toArray().then(allocations => {
            if (!allocations.length) throw "ERROR: No allocations found for the user";

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
