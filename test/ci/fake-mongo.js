"use strict";

// In-memory stand-in for a MongoDB driver 7.x Db, shared by the unit tests.
// It exposes only the driver 7 promise API: leftover 2.x calls (insert, update,
// findAndModify) are missing, and passing a callback to a driver method throws.

const assert = require("node:assert");

const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "$ne" in cond) return doc[key] !== cond.$ne;
    if (cond && typeof cond === "object" && "$gt" in cond) return doc[key] > cond.$gt;
    return doc[key] === cond;
});

const noCallback = (name, args) => {
    if (args.some(arg => typeof arg === "function")) {
        throw new TypeError(`${name}() was given a callback; driver 5+ only returns promises`);
    }
};

class FakeCursor {
    constructor(docs) {
        this.docs = docs;
    }
    sort(spec) {
        const [[key, dir]] = Object.entries(spec);
        this.docs.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir);
        return this;
    }
    toArray(...args) {
        noCallback("toArray", args);
        return Promise.resolve(this.docs.map(doc => ({ ...doc })));
    }
}

class FakeCollection {
    constructor() {
        this.docs = [];
    }
    find(filter, ...rest) {
        noCallback("find", rest);
        this.lastFilter = filter;
        return new FakeCursor(this.docs.filter(doc => matches(doc, filter || {})));
    }
    findOne(filter, ...rest) {
        noCallback("findOne", rest);
        const doc = this.docs.find(d => matches(d, filter));
        return Promise.resolve(doc ? { ...doc } : null);
    }
    insertOne(doc, ...rest) {
        noCallback("insertOne", rest);
        this.docs.push({ ...doc });
        return Promise.resolve({ acknowledged: true, insertedId: doc._id });
    }
    replaceOne(filter, replacement, ...rest) {
        noCallback("replaceOne", rest);
        const options = rest[0] || {};
        const index = this.docs.findIndex(d => matches(d, filter));
        if (index >= 0) this.docs[index] = { ...replacement, _id: this.docs[index]._id };
        else if (options.upsert) this.docs.push({ ...replacement });
        return Promise.resolve({ acknowledged: true, matchedCount: index >= 0 ? 1 : 0 });
    }
    updateOne(filter, update, ...rest) {
        noCallback("updateOne", rest);
        const doc = this.docs.find(d => matches(d, filter));
        if (doc) Object.assign(doc, update.$set);
        return Promise.resolve({ acknowledged: true, matchedCount: doc ? 1 : 0 });
    }
    findOneAndUpdate(filter, update, ...rest) {
        noCallback("findOneAndUpdate", rest);
        const options = rest[0] || {};
        assert.strictEqual(options.returnDocument, "after", "counter must return the updated document");
        const doc = this.docs.find(d => matches(d, filter));
        if (!doc) return Promise.resolve(null);
        Object.entries(update.$inc).forEach(([key, by]) => { doc[key] += by; });
        // Driver 6.0+: resolves to the document itself, not { value: doc }.
        return Promise.resolve({ ...doc });
    }
}

const fakeDb = () => {
    const collections = {};
    return {
        collections,
        collection: name => (collections[name] = collections[name] || new FakeCollection())
    };
};

// Seed data matching artifacts/db-reset.js.
const seededDb = () => {
    const db = fakeDb();
    db.collection("counters").docs.push({ _id: "userId", seq: 3 });
    db.collection("users").docs.push(
        { _id: 1, userName: "admin", firstName: "Node Goat", lastName: "Admin", password: "Admin_123", isAdmin: true },
        { _id: 2, userName: "user1", firstName: "John", lastName: "Doe", password: "User1_123" },
        { _id: 3, userName: "user2", firstName: "Will", lastName: "Smith", password: "User2_123" }
    );
    db.collection("allocations").docs.push({ userId: 2, stocks: 10, funds: 20, bonds: 70 });
    return db;
};

module.exports = { fakeDb, seededDb };
