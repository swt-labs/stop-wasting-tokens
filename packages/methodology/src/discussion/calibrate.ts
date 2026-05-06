import type { Calibration, CalibrationSignals } from './types.js';

const ARCHITECT_HINTS = [
  /\barchitect\b/i,
  /\benterprise\b/i,
  /\bdeep dive\b/i,
  /\boptions\b/i,
  /\bexplore\b/i,
  /\btradeoff/i,
];

const BUILDER_HINTS = [
  /\bjust\b/i,
  /\bquick\b/i,
  /\bminimal\b/i,
  /\bsimple\b/i,
  /\bship\b/i,
  /\bessentials\b/i,
];

export function inferCalibration(signals: CalibrationSignals = {}): Calibration {
  if (signals.forced !== undefined) return signals.forced;

  const text = [signals.description ?? '', ...(signals.hints ?? [])].join(' ');
  if (text.trim().length === 0) return 'builder';

  let architectScore = 0;
  let builderScore = 0;
  for (const re of ARCHITECT_HINTS) {
    if (re.test(text)) architectScore += 1;
  }
  for (const re of BUILDER_HINTS) {
    if (re.test(text)) builderScore += 1;
  }

  // Long, technical descriptions skew architect.
  if ((signals.description ?? '').length > 240) architectScore += 1;

  if (architectScore > builderScore) return 'architect';
  return 'builder';
}
