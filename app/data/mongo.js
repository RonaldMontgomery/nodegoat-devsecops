"use strict";

// Helpers for the MongoDB Node.js driver 7.x.
//
// Driver 5.0 removed callback support: every driver call now returns a promise.
// NodeGoat's routes are written in callback style, so the DAOs keep their
// callback(err, result) signatures and use toCallback() to bridge the two.

const { MongoClient } = require("mongodb");

// Settle a promise into a Node-style callback. The callback runs on the next
// tick, outside the promise chain, so an exception thrown by a route handler
// surfaces as an ordinary uncaught exception (as it did with driver 2.x)
// instead of being swallowed or invoking the callback a second time.
const toCallback = (promise, callback) => {
    promise.then(
        result => process.nextTick(callback, null, result),
        err => process.nextTick(callback, err, null)
    );
};

// Driver 3.0+ resolves connect() to a MongoClient, not a Db. The database name
// comes from the connection string (e.g. mongodb://host:27017/nodegoat).
const connect = (url, callback) => {
    toCallback(MongoClient.connect(url).then(client => client.db()), callback);
};

module.exports = { toCallback, connect };
