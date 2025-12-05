module.exports = require('@backstage/cli/config/eslint-factory')(__dirname, {
  ignorePatterns: ['templates/**', 'coverage/**', '**/lcov-report/**'],
  rules: {
    'no-console': 0,
  },
});
