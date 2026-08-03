/**
 * Shared env-based worker options for BullMQ @Processor decorators.
 * Autorun is false when QUEUE_WORKER_ENABLED/SQS_WORKER_ENABLED is "false".
 */
export function bullmqProcessorOptions() {
  return {
    concurrency: parseInt(
      process.env.QUEUE_WORKER_CONCURRENCY ||
        process.env.SQS_WORKER_CONCURRENCY ||
        '4',
      10,
    ),
    lockDuration: (() => {
      if (process.env.QUEUE_WORKER_LOCK_DURATION_MS) {
        return parseInt(process.env.QUEUE_WORKER_LOCK_DURATION_MS, 10);
      }
      if (process.env.SQS_VISIBILITY_TIMEOUT_SECONDS) {
        return parseInt(process.env.SQS_VISIBILITY_TIMEOUT_SECONDS, 10) * 1000;
      }
      return 900000;
    })(),
    autorun:
      (process.env.QUEUE_WORKER_ENABLED ?? process.env.SQS_WORKER_ENABLED) !==
      'false',
  };
}
