// Demand uses observed intervals; daily energy uses complete days only.
// Missing readings are never treated as zero. Inputs are already date-filtered.
const MeterStatistics = (() => {
  function describe(values) {
    if (!values.length) return { mean: null, median: null };
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      median: sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    };
  }

  function summarise(channel) {
    const demand = [], dailyEnergy = [];
    let incompleteDays = 0;
    const interval = channel?.intervalLen;
    if (channel?.unit?.toUpperCase() !== 'KWH' ||
        !Number.isFinite(interval) || interval <= 0 ||
        !Number.isInteger(1440 / interval)) {
      return { demand: describe([]), dailyEnergy: describe([]),
        observedIntervals: 0, completeDays: 0, incompleteDays: 0 };
    }
    const expected = 1440 / interval;
    for (const day of Object.values(channel.data || {})) {
      const values = Array.isArray(day.values) ? day.values : [];
      const observed = values.filter(Number.isFinite);
      for (const value of observed) demand.push(value * 60 / interval);
      if (values.length === expected && observed.length === expected) {
        dailyEnergy.push(observed.reduce((sum, value) => sum + value, 0));
      } else {
        incompleteDays++;
      }
    }
    return { demand: describe(demand), dailyEnergy: describe(dailyEnergy),
      observedIntervals: demand.length, completeDays: dailyEnergy.length,
      incompleteDays };
  }

  return Object.freeze({ summarise });
})();
