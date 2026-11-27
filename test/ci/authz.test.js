"use strict";

// A4 broken object-level authorization (BOLA) tests for /allocations/:userId.
// Run with: npm run test:unit   (Node's built-in test runner)
//
// The route used to trust the user id in the URL, so any logged-in user could
// read another user's allocations by changing the number. Two synthetic users
// from the seed data are used: user1 (_id 2) and user2 (_id 3).

const test = require("node:test");
const assert = require("node:assert");
const { seededDb } = require("./fake-mongo");
const AllocationsHandler = require("../../app/routes/allocations");

const USER1 = 2;
const USER2 = 3;

const withAllUsers = () => {
    const db = seededDb();
    db.collection("allocations").docs.push(
        { userId: 1, stocks: 40, funds: 40, bonds: 20 },
        { userId: USER2, stocks: 30, funds: 30, bonds: 40 }
    );
    return db;
};

// Call the route handler with a fake request and response; resolves with what it sent.
const get = (db, { sessionUserId, paramUserId, threshold }) => new Promise((resolve, reject) => {
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        render(view, locals) {
            resolve({ status: this.statusCode, view, locals });
        },
        redirect(url) {
            resolve({ status: 302, url });
        }
    };
    const req = {
        params: { userId: paramUserId },
        query: threshold === undefined ? {} : { threshold },
        session: { userId: sessionUserId }
    };
    new AllocationsHandler(db).displayAllocations(req, res, reject);
});

const shownUserIds = result => (result.locals.allocations || []).map(a => a.userId);

test("A4: a user can view their own allocations", async () => {
    const result = await get(withAllUsers(), { sessionUserId: USER1, paramUserId: String(USER1) });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(shownUserIds(result), [USER1]);
});

test("A4: user1 cannot read user2's or the admin's allocations by changing the URL", async () => {
    for (const target of [USER2, 1]) {
        const db = withAllUsers();
        const result = await get(db, { sessionUserId: USER1, paramUserId: String(target) });
        assert.strictEqual(result.status, 403, `GET /allocations/${target} as user1`);
        assert.deepStrictEqual(shownUserIds(result), [], `another user's allocations were rendered`);
        assert.strictEqual(db.collection("allocations").lastFilter, undefined, "a query ran for another user");
    }
});

test("A4: the check also holds in the other direction and with a threshold", async () => {
    const reverse = await get(withAllUsers(), { sessionUserId: USER2, paramUserId: String(USER1) });
    assert.strictEqual(reverse.status, 403);
    const filtered = await get(withAllUsers(), { sessionUserId: USER1, paramUserId: String(USER2), threshold: "0" });
    assert.strictEqual(filtered.status, 403);
    assert.deepStrictEqual(shownUserIds(filtered), []);
});

test("A4: look-alike ids are refused rather than parsed", async () => {
    // parseInt("3abc") === 3 and parseInt("2.9") === 2, so loose parsing would let
    // these through to some user's record.
    for (const id of ["3abc", "03", "2.9", " 3", "-3", ""]) {
        const result = await get(withAllUsers(), { sessionUserId: USER1, paramUserId: id });
        assert.strictEqual(result.status, 403, `GET /allocations/${JSON.stringify(id)}`);
    }
});
