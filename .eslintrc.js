module.exports = require('@backstage/cli/config/eslint-factory')(__dirname, {
  ignorePatterns: ['templates/**', 'coverage/**'],
  rules: {
    'no-console': 0,
  },
});
