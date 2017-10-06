/**
 * Creates a rate limited version of the given function with a cooldown period.
 * Every invokation of the result will be passed through to the target function
 * in the same order, but after waiting for the cooldown period to expire.
 *
 * @param {Function} callback A function to be rate limited
 * @param {Number}   delay    The cooldown time in milliseconds
 */
function rateLimit(callback, delay) {
  let mutex = Promise.resolve();

  // We need to return a plain function here since we need to propagate "this"
  return function rateLimitedCallback(...params) {
    const result = mutex.then(() => callback.apply(this, params));
    mutex = mutex.then(() => new Promise(resolve => setTimeout(resolve, delay)));
    return result;
  };
}

/**
 * Asynchronously calls the predicate on every element of the array and filters
 * for all elements where the predicate resolves to true.
 *
 * @param {Array} array An array to filter
 * @param {Function} predicate A predicate function that resolves to a boolean
 * @param {any} args Any further args passed to the predicate
 */
async function filterAsync(array, predicate, ...args) {
  const verdicts = await Promise.all(array.map(predicate, ...args));
  return array.filter((element, index) => verdicts[index]);
}

module.exports = {
  rateLimit,
  filterAsync,
};
