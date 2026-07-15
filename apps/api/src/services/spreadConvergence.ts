import { config } from "../config/env.js";
import type { SpreadConvergenceContext, SpreadHistorySample } from "../types/market.js";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function estimateSampleIntervalHours(samples: SpreadHistorySample[]): number {
  const intervals = samples.slice(1).map((sample, index) => sample.timestamp - samples[index].timestamp)
    .filter((value) => value > 0 && value <= 60 * 60 * 1000);
  return intervals.length > 0 ? median(intervals) / 3_600_000 : 5 / 60;
}

function estimateHalfLifeHours(deviations: number[], intervalHours: number): number | null {
  if (deviations.length < 3) return null;
  const previous = deviations.slice(0, -1);
  const next = deviations.slice(1);
  const previousMean = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  const nextMean = next.reduce((sum, value) => sum + value, 0) / next.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < previous.length; index += 1) {
    covariance += (previous[index] - previousMean) * (next[index] - nextMean);
    variance += (previous[index] - previousMean) ** 2;
  }
  if (variance <= 0) return null;
  const phi = covariance / variance;
  if (phi <= 0) return intervalHours;
  if (phi >= 0.9999) return null;
  return Math.log(0.5) / Math.log(phi) * intervalHours;
}

function estimateConvergenceRate(input: {
  deviations: number[];
  sigma: number;
  intervalHours: number;
}): { rate: number | null; observations: number } {
  if (input.sigma <= 0) return { rate: null, observations: 0 };
  const horizonSteps = Math.max(1, Math.round(4 / input.intervalHours));
  let observations = 0;
  let converged = 0;

  for (let index = 0; index + horizonSteps < input.deviations.length; index += 1) {
    const current = Math.abs(input.deviations[index]);
    if (current < config.crossVenueConvergenceZScore * input.sigma) continue;
    observations += 1;
    if (Math.abs(input.deviations[index + horizonSteps]) < current) converged += 1;
  }

  return { rate: observations > 0 ? converged / observations : null, observations };
}

export function analyzeSpreadConvergence(
  rawSamples: SpreadHistorySample[],
  currentSignedSpread: number
): SpreadConvergenceContext {
  const samples = [...rawSamples].filter((sample) => Number.isFinite(sample.signedSpread))
    .sort((a, b) => a.timestamp - b.timestamp);
  const spreads = samples.map((sample) => sample.signedSpread);
  const medianSignedSpread = median(spreads);
  const deviations = spreads.map((spread) => spread - medianSignedSpread);
  const madSigma = median(deviations.map(Math.abs)) * 1.4826;
  const fallbackSigma = standardDeviation(deviations);
  const robustSigma = madSigma > 0.000001 ? madSigma : fallbackSigma;
  const deviationFromMedian = currentSignedSpread - medianSignedSpread;
  const zScore = robustSigma > 0 ? deviationFromMedian / robustSigma : 0;
  const absoluteDeviation = Math.abs(deviationFromMedian);
  const absoluteDeviationPercentile = deviations.length > 0
    ? deviations.filter((value) => Math.abs(value) <= absoluteDeviation).length / deviations.length
    : 0;
  const intervalHours = estimateSampleIntervalHours(samples);
  const convergence = estimateConvergenceRate({ deviations, sigma: robustSigma, intervalHours });
  const halfLifeHours = estimateHalfLifeHours(deviations, intervalHours);
  const historicalReady = samples.length >= config.crossVenueHistoryMinSamples && robustSigma > 0;
  const meanRevertingEnough =
    (halfLifeHours != null && halfLifeHours <= config.crossVenueMaxHalfLifeHours) ||
    (convergence.rate != null && convergence.rate >= 0.5);
  const isAbnormal = historicalReady && meanRevertingEnough && (
    Math.abs(zScore) >= config.crossVenueConvergenceZScore ||
    absoluteDeviationPercentile >= config.crossVenueConvergencePercentile
  );
  const windowHours = samples.length > 1
    ? (samples.at(-1)!.timestamp - samples[0].timestamp) / 3_600_000
    : 0;

  return {
    historicalReady,
    sampleCount: samples.length,
    windowHours,
    currentSignedSpread,
    medianSignedSpread,
    deviationFromMedian,
    robustSigma,
    zScore,
    absoluteDeviationPercentile,
    halfLifeHours,
    historicalConvergenceRate: convergence.rate,
    historicalConvergenceObservations: convergence.observations,
    isAbnormal
  };
}
