#!/usr/bin/env nodejs

"use strict";

// This script initializes the database. You can set the environment variable
// before running it (default: development). ie:
// NODE_ENV=production node artifacts/db-reset.js

const { MongoClient } = require("mongodb");
const { db } = require("../config/config");

const USERS_TO_INSERT = [
    {
        "_id": 1,
        "userName": "admin",
        "firstName": "Node Goat",
        "lastName": "Admin",
        "password": "Admin_123",
        "isAdmin": true
    }, {
        "_id": 2,
        "userName": "user1",
        "firstName": "John",
        "lastName": "Doe",
        "benefitStartDate": "2030-01-10",
        "password": "User1_123"
    }, {
        "_id": 3,
        "userName": "user2",
        "firstName": "Will",
        "lastName": "Smith",
        "benefitStartDate": "2025-11-30",
        "password": "User2_123"
    }];

const collectionNames = [
    "users",
    "allocations",
    "contributions",
    "memos",
    "counters"
];

// MongoDB driver 7.x: connect() resolves to a MongoClient and every call returns a promise.
const reset = async () => {
    const client = await MongoClient.connect(db);
    console.log("Connected to the database");
    const database = client.db();

    try {
        // remove existing data (if any), we don't want to look for errors here
        console.log("Dropping existing collections");
        await Promise.all(collectionNames.map(name => database.dropCollection(name)
            .then(() => console.log(`Dropped collection: ${name}`))
            .catch(() => undefined)));

        // reset unique id counter
        const counter = await database.collection("counters").insertOne({
            _id: "userId",
            seq: 3
        });
        console.log("countersCol.insertOne");
        console.log(JSON.stringify(counter));

        // insert admin and test users
        console.log("Users to insert:");
        USERS_TO_INSERT.forEach((user) => console.log(JSON.stringify(user)));
        const users = await database.collection("users").insertMany(USERS_TO_INSERT);
        console.log("users.insertMany");
        console.log(JSON.stringify(users));

        // Driver 4.0 removed result.ops, so build allocations from the seed list itself.
        const finalAllocations = USERS_TO_INSERT.map((user) => {
            const stocks = Math.floor((Math.random() * 40) + 1);
            const funds = Math.floor((Math.random() * 40) + 1);
            return {
                userId: user._id,
                stocks: stocks,
                funds: funds,
                bonds: 100 - (stocks + funds)
            };
        });

        console.log("Allocations to insert:");
        finalAllocations.forEach(allocation => console.log(JSON.stringify(allocation)));
        const allocations = await database.collection("allocations").insertMany(finalAllocations);
        console.log("allocations.insertMany");
        console.log(JSON.stringify(allocations));
    } finally {
        await client.close();
    }
};

// Starting here
reset().then(() => {
    console.log("Database reset performed successfully");
    process.exit(0);
}, (err) => {
    console.log("ERROR:");
    console.log(err && err.message ? err.message : JSON.stringify(err));
    process.exit(1);
});
