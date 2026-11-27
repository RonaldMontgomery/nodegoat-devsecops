"use strict";

// ESLint flat config, replacing upstream's jshint 2.12 (unmaintained; it pulled in
// shelljs 0.3, minimatch 3.0 and lodash 4.17.21 with open HIGH CVEs).
// Rules are listed explicitly instead of extending a shared preset, so the only
// lint dependency is eslint itself. They mirror the old .jshintrc: double quotes,
// ===, no undeclared globals, 120-column lines, no empty blocks.

const nodeGlobals = {
    require: "readonly",
    module: "writable",
    exports: "writable",
    process: "readonly",
    console: "readonly",
    Buffer: "readonly",
    __dirname: "readonly",
    __filename: "readonly",
    setTimeout: "readonly",
    clearTimeout: "readonly",
    setInterval: "readonly",
    clearInterval: "readonly",
    setImmediate: "readonly",
    URL: "readonly"
};

const browserGlobals = {
    window: "readonly",
    document: "readonly",
    navigator: "readonly",
    location: "readonly",
    console: "readonly"
    // $, Morris and Tour are declared in each file with /* global ... */
};

const rules = {
    "eqeqeq": "error",
    "no-undef": "error",
    "no-empty": "error",
    "no-redeclare": "error",
    "no-dupe-keys": "error",
    "no-unreachable": "error",
    "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
    "no-caller": "error",
    "new-cap": ["error", { capIsNew: false }],
    "quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
    "max-len": ["error", { code: 120, ignoreUrls: true }],
    "no-trailing-spaces": "error"
};

module.exports = [
    {
        ignores: ["node_modules/**", "app/assets/vendor/**", "coverage/**"]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: nodeGlobals
        },
        rules
    },
    {
        files: ["app/assets/js/**/*.js"],
        languageOptions: {
            sourceType: "script",
            globals: browserGlobals
        }
    }
];
