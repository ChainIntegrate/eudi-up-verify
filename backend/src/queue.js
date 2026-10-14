// Runs jobs one at a time, in order. Decisions and minting go through it, so two submissions of the same
// person can never race (and the attester key never sends two transactions at once).
export function createSerialQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    push(job) {
      pending++;
      const run = tail.then(job).finally(() => pending--);
      tail = run.catch(() => {});
      return run;
    },
    get size() {
      return pending;
    },
    idle: () => tail,
  };
}
