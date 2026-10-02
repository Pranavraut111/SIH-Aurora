/* Aurora — wind chill (JAG/TI formula, as used by Environment Canada and the US NWS).
   °C and km/h; defined only for T ≤ 10 °C and V ≥ 4.8 km/h, otherwise null. */
import { isNum } from './format';

export function windChill(tempC, windKmh) {
  if (!isNum(tempC) || !isNum(windKmh) || tempC > 10 || windKmh < 4.8) return null;
  const v = windKmh ** 0.16;
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}
