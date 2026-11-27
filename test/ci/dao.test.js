"use strict";

// DAO contract tests for the MongoDB driver 7.x port.
// Run with: npm run test:unit   (Node's built-in test runner)
//
// The DAOs run against an in-memory fake that exposes only the driver 7.x
// promise API. Any leftover 2.x call (insert, update, findAndModify, result.ops)
// or a callback passed to a driver method fails the test, which is how the old
// code would silently break against the real driver. The CI smoke test then
// exercises the same paths against a real MongoDB.

const test = require("node:test");
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

// Promise wrapper for the DAOs' callback(err, result) interface. Also fails the
// test if a DAO ever calls back more than once.
const call = (fn, ...args) => new Promise((resolve, reject) => {
    let calls = 0;
    fn(...args, (err, result) => {
        calls += 1;
        if (calls > 1) return reject(new Error("callback invoked more than once"));
        setImmediate(() => (err ? reject(err) : resolve(result)));
    });
});

const { UserDAO } = require("../../app/data/user-dao");
const { AllocationsDAO } = require("../../app/data/allocations-dao");
const { ContributionsDAO } = require("../../app/data/contributions-dao");
const { BenefitsDAO } = require("../../app/data/benefits-dao");
const { MemosDAO } = require("../../app/data/memos-dao");
const { ProfileDAO } = require("../../app/data/profile-dao");

test("UserDAO.addUser takes the next id from the counter and returns the stored user", async () => {
    const db = seededDb();
    const users = new UserDAO(db);
    const user = await call(users.addUser, "user3", "Ada", "Lovelace", "Pass_123", "ada@example.test");
    assert.strictEqual(user._id, 4);
    assert.strictEqual(user.userName, "user3");
    assert.strictEqual(db.collection("counters").docs[0].seq, 4);
    assert.strictEqual(db.collection("users").docs.length, 4);
});

test("UserDAO.getNextSequence reports a missing counter instead of crashing", async () => {
    const users = new UserDAO(fakeDb());
    await assert.rejects(call(users.getNextSequence, "userId"), /Counter "userId" not found/);
});

test("UserDAO.validateLogin accepts the right password and flags wrong ones", async () => {
    const users = new UserDAO(seededDb());
    const user = await call(users.validateLogin, "user1", "User1_123");
    assert.strictEqual(user._id, 2);
    await assert.rejects(call(users.validateLogin, "user1", "wrong"), err => err.invalidPassword === true);
    await assert.rejects(call(users.validateLogin, "nobody", "x"), err => err.noSuchUser === true);
});

test("UserDAO lookups by id and by user name", async () => {
    const users = new UserDAO(seededDb());
    assert.strictEqual((await call(users.getUserById, "3")).userName, "user2");
    assert.strictEqual((await call(users.getUserByUserName, "admin"))._id, 1);
    assert.strictEqual(await call(users.getUserByUserName, "nobody"), null);
});

test("AllocationsDAO.update upserts and calls back once with user details", async () => {
    const db = seededDb();
    const allocations = new AllocationsDAO(db);
    const result = await call(allocations.update, 3, 30, 30, 40);
    assert.strictEqual(result.userName, "user2");
    assert.strictEqual(db.collection("allocations").docs.length, 2);
    await call(allocations.update, 3, 50, 25, 25);
    assert.strictEqual(db.collection("allocations").docs.length, 2, "second update replaces, not inserts");
});

test("AllocationsDAO.getByUserIdAndThreshold returns the user's allocations", async () => {
    const allocations = new AllocationsDAO(seededDb());
    const [alloc] = await call(allocations.getByUserIdAndThreshold, "2", undefined);
    assert.strictEqual(alloc.stocks, 10);
    assert.strictEqual(alloc.firstName, "John");
    await assert.rejects(call(allocations.getByUserIdAndThreshold, "3", undefined), /No allocations found/);
});

// A1 NoSQL injection: the allocations "threshold" filter used to be pasted into a
// $where JavaScript string, so "1'; return 1 == '1" returned every user's
// allocations and "0';while(true){}'" hung the database.
const allocationsForAllUsers = () => {
    const db = seededDb();
    db.collection("allocations").docs.push(
        { userId: 1, stocks: 40, funds: 40, bonds: 20 },
        { userId: 3, stocks: 30, funds: 30, bonds: 40 }
    );
    return db;
};

test("A1: threshold is a typed comparison, never server-side JavaScript", async () => {
    const db = allocationsForAllUsers();
    const allocations = new AllocationsDAO(db);
    const result = await call(allocations.getByUserIdAndThreshold, "2", "5");
    assert.deepStrictEqual(db.collection("allocations").lastFilter, { userId: 2, stocks: { $gt: 5 } });
    assert.deepStrictEqual(result.map(a => a.userId), [2]);
});

test("A1: injection payloads are rejected before any query runs", async () => {
    const payloads = [
        "1'; return 1 == '1",
        "0';while(true){}'",
        "5 || 1 == 1",
        "-1",
        "100",
        "1.5",
        "abc",
        { $gt: 0 },
        ["1", "2"]
    ];
    for (const payload of payloads) {
        const db = allocationsForAllUsers();
        const allocations = new AllocationsDAO(db);
        await assert.rejects(call(allocations.getByUserIdAndThreshold, "2", payload),
            err => err.invalidThreshold === true, `payload not rejected: ${JSON.stringify(payload)}`);
        assert.strictEqual(db.collection("allocations").lastFilter, undefined,
            `a query ran for payload ${JSON.stringify(payload)}`);
    }
});

test("A1: the rejection message does not echo the attacker's input", async () => {
    const allocations = new AllocationsDAO(allocationsForAllUsers());
    await assert.rejects(call(allocations.getByUserIdAndThreshold, "2", "<script>x</script>"),
        err => !err.message.includes("<script>"));
});

test("A1: a threshold above every allocation returns an empty list, not an error", async () => {
    const allocations = new AllocationsDAO(allocationsForAllUsers());
    assert.deepStrictEqual(await call(allocations.getByUserIdAndThreshold, "2", "99"), []);
});

test("ContributionsDAO returns defaults, then the saved values", async () => {
    const contributions = new ContributionsDAO(seededDb());
    const defaults = await call(contributions.getByUserId, 2);
    assert.deepStrictEqual([defaults.preTax, defaults.afterTax, defaults.roth], [2, 2, 2]);
    await call(contributions.update, 2, 5, 6, 7);
    const saved = await call(contributions.getByUserId, 2);
    assert.deepStrictEqual([saved.preTax, saved.afterTax, saved.roth], [5, 6, 7]);
    assert.strictEqual(saved.userName, "user1");
});

test("BenefitsDAO lists non-admin users and updates a start date", async () => {
    const db = seededDb();
    const benefits = new BenefitsDAO(db);
    const users = await call(benefits.getAllNonAdminUsers);
    assert.deepStrictEqual(users.map(u => u.userName).sort(), ["user1", "user2"]);
    await call(benefits.updateBenefits, "2", "2031-01-01");
    assert.strictEqual(db.collection("users").docs[1].benefitStartDate, "2031-01-01");
});

test("MemosDAO inserts memos and lists newest first", async () => {
    const memos = new MemosDAO(fakeDb());
    await call(memos.insert, "first");
    await new Promise(resolve => setTimeout(resolve, 5));
    await call(memos.insert, "second");
    const list = await call(memos.getAllMemos);
    assert.deepStrictEqual(list.map(m => m.memo), ["second", "first"]);
});

test("ProfileDAO updates and reads a profile", async () => {
    const profile = new ProfileDAO(seededDb());
    const updated = await call(profile.updateUser, "2", "Johnny", "", "", "", "1 Main St", "", "");
    assert.deepStrictEqual(updated, { firstName: "Johnny", address: "1 Main St" });
    const user = await call(profile.getByUserId, "2");
    assert.strictEqual(user.firstName, "Johnny");
    assert.strictEqual(user.lastName, "Doe");
});
