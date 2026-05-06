/**
 * Thrown when Claude determines the audio is not a valid sales call
 * (silent, wrong language, internal conversation, etc.).
 *
 * Distinguishes from generic Error to allow:
 * - failJob/failAnalysis to set status='rejected'/'rechazado' instead of 'error'
 * - Skip retries (rejection is deterministic)
 * - Frontend to render specific UX
 */
export class RejectedAnalysisError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "RejectedAnalysisError";
  }
}
