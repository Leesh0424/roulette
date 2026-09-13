(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Roulette = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // random defaults to Math.random but is injectable so tests can be deterministic.
  function pickWinnerIndex(itemCount, random) {
    if (!Number.isInteger(itemCount) || itemCount <= 0) {
      throw new RangeError("itemCount must be a positive integer");
    }
    const rand = typeof random === "function" ? random : Math.random;
    return Math.floor(rand() * itemCount);
  }

  return { pickWinnerIndex };
});
