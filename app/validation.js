"use strict";

// Input validation helpers.

// Fix for ReDoS: the upstream check /([0-9]+)+\#/ nests two "+" quantifiers, so on a
// long run of digits without the '#' the regex engine tries every way of splitting the
// digits (exponential time) and blocks Node's single thread. This pattern has a single
// bounded quantifier, is anchored, and requires the whole value to be 1-17 digits
// followed by '#' (US routing numbers are 9 digits; 17 leaves room for other formats).
// A length check runs first, so oversized input never reaches the regex.
const BANK_ROUTING_RE = /^[0-9]{1,17}#$/;

const isValidBankRouting = value =>
    typeof value === "string" && value.length <= 18 && BANK_ROUTING_RE.test(value);

module.exports = { isValidBankRouting };
