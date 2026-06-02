// Plain console output for e2e tests (no Jest "console.log" label or stack trace)
console.log = (...args) => {
  process.stdout.write(`${args.map(String).join(' ')}\n`);
};
console.error = (...args) => {
  process.stderr.write(`${args.map(String).join(' ')}\n`);
};
