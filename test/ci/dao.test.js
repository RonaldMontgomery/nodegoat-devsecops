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

const { fakeDb, seededDb } = require("./fake-mongo");

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
    // The account is created through addUser so the test does not depend on how
    // passwords are stored.
    const users = new UserDAO(seededDb());
    const created = await call(users.addUser, "user9", "Grace", "Hopper", "Grace_123", "");
    const user = await call(users.validateLogin, "user9", "Grace_123");
    assert.strictEqual(user._id, created._id);
    await assert.rejects(call(users.validateLogin, "user9", "wrong"), err => err.invalidPassword === true);
    await assert.rejects(call(users.validateLogin, "nobody", "x"), err => err.noSuchUser === true);
});

// A2 Broken Authentication: passwords used to be stored and compared in plaintext,
// so anyone who could read the users collection (or a backup) had every password.
test("A2: addUser never stores the plaintext password", async () => {
    const db = seededDb();
    const users = new UserDAO(db);
    await call(users.addUser, "user9", "Grace", "Hopper", "Grace_123", "");
    const stored = db.collection("users").docs.find(u => u.userName === "user9").password;
    assert.notStrictEqual(stored, "Grace_123", "password stored in plaintext");
    assert.ok(!String(stored).includes("Grace_123"), "plaintext password is part of the stored value");
    assert.match(String(stored), /^scrypt\$/, `stored value is not a scrypt hash: ${stored}`);
});

test("A2: the same password gets a different salt for each user", async () => {
    const db = seededDb();
    const users = new UserDAO(db);
    await call(users.addUser, "user8", "Ada", "Lovelace", "Same_Pass1", "");
    await call(users.addUser, "user9", "Grace", "Hopper", "Same_Pass1", "");
    const [a, b] = ["user8", "user9"].map(n => db.collection("users").docs.find(u => u.userName === n).password);
    assert.notStrictEqual(a, b);
});

test("A2: a plaintext password left in the database does not log in", async () => {
    // seededDb() stores "User1_123" in plaintext, as upstream NodeGoat did. There must be
    // no fallback that compares plaintext; such accounts need their password reset.
    const users = new UserDAO(seededDb());
    await assert.rejects(call(users.validateLogin, "user1", "User1_123"), err => err.invalidPassword === true);
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

// A6 Sensitive Data Exposure: SSN, date of birth and bank details used to be stored in
// plaintext, so anyone with database (or backup) access could read them.
const SENSITIVE = { ssn: "123-45-6789", dob: "1990-01-31", bankAcc: "99887766", bankRouting: "123456#" };
const saveSensitive = (profile, userId) => call(profile.updateUser, userId, "", "", SENSITIVE.ssn, SENSITIVE.dob,
    "", SENSITIVE.bankAcc, SENSITIVE.bankRouting);

test("A6: SSN, date of birth and bank details are encrypted at rest", async () => {
    const db = seededDb();
    const profile = new ProfileDAO(db);
    await saveSensitive(profile, "2");
    const stored = db.collection("users").docs.find(u => u._id === 2);
    for (const [field, plain] of Object.entries(SENSITIVE)) {
        assert.ok(!String(stored[field]).includes(plain), `${field} stored in plaintext: ${stored[field]}`);
        assert.match(String(stored[field]), /^enc:v1:/, `${field} is not in the encrypted format`);
    }
});

test("A6: the owner still reads the original values", async () => {
    const profile = new ProfileDAO(seededDb());
    await saveSensitive(profile, "2");
    const user = await call(profile.getByUserId, "2");
    for (const [field, plain] of Object.entries(SENSITIVE)) assert.strictEqual(user[field], plain, field);
});

test("A6: equal values encrypt differently (random IV per value)", async () => {
    const db = seededDb();
    const profile = new ProfileDAO(db);
    await saveSensitive(profile, "2");
    await saveSensitive(profile, "3");
    const [a, b] = [2, 3].map(id => db.collection("users").docs.find(u => u._id === id).ssn);
    assert.notStrictEqual(a, b);
});

test("A6: a tampered ciphertext is rejected, not decrypted to something else", async () => {
    const db = seededDb();
    const profile = new ProfileDAO(db);
    await saveSensitive(profile, "2");
    const doc = db.collection("users").docs.find(u => u._id === 2);
    const parts = doc.ssn.split(":");
    const ct = Buffer.from(parts[4], "base64");
    ct[0] ^= 0x01;
    parts[4] = ct.toString("base64");
    doc.ssn = parts.join(":");
    const user = await call(profile.getByUserId, "2");
    assert.strictEqual(user.ssn, "", "tampered SSN should not be shown");
    assert.strictEqual(user.dob, SENSITIVE.dob, "other fields unaffected");
});

test("ProfileDAO updates and reads a profile", async () => {
    const profile = new ProfileDAO(seededDb());
    const updated = await call(profile.updateUser, "2", "Johnny", "", "", "", "1 Main St", "", "");
    assert.deepStrictEqual(updated, { firstName: "Johnny", address: "1 Main St" });
    const user = await call(profile.getByUserId, "2");
    assert.strictEqual(user.firstName, "Johnny");
    assert.strictEqual(user.lastName, "Doe");
});
