/* Aurora — plain-language description of an ApiError, for error states. */

/** "the backend returned HTTP 500" / "the backend is unreachable", from an ApiError. */
export function describeFailure(err) {
  if (!err) return '';
  if (err.kind === 'http') return `the backend returned HTTP ${err.status}`;
  if (err.kind === 'timeout') return 'the backend did not answer in time';
  return 'the backend is unreachable';
}
