/* Aurora — wind chill (JAG/TI formula, as used by Environment Canada and the US NWS).
   °C and km/h; defined only for T ≤ 10 °C and V ≥ 4.8 km/h, otherwise null. */
import { isNum } from './format';

export function windChill(tempC, windKmh) {
  if (!isNum(tempC) || !isNum(windKmh) || tempC > 10 || windKmh < 4.8) return null;
  const v = windKmh ** 0.16;
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/**
 * Environment Canada wind-chill risk bands (exposed skin). `status` is a status
 * colour key for the chip; `text` is the published guidance, never a made-up time.
 */
export function frostbiteRisk(wc) {
  if (!isNum(wc)) return null;
  if (wc > -10) return { level: 'Low', status: 'normal', text: 'Low risk of frostbite.' };
  if (wc > -28) return { level: 'Moderate', status: 'normal', text: 'Low risk of frostbite; risk of hypothermia with long exposure.' };
  if (wc > -40) return { level: 'High', status: 'warning', text: 'Exposed skin can freeze in 10–30 minutes.' };
  if (wc > -48) return { level: 'Very high', status: 'critical', text: 'Exposed skin can freeze in 5–10 minutes.' };
  if (wc > -55) return { level: 'Severe', status: 'critical', text: 'Exposed skin can freeze in 2–5 minutes.' };
  return { level: 'Extreme', status: 'critical', text: 'Exposed skin can freeze in under 2 minutes.' };
}
