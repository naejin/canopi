/**
 * The qualification host's WebView entry.
 *
 * It owns exactly one worker for the one run it was given, relays native bounded reads
 * to it, and reports the worker's result to the host. It does not decode rasters, does
 * not choose a path, and does not write a report.
 *
 * One run settles once. A worker error, a native rejection, a cancellation and normal
 * completion all end in the same place, and no late reply can move a run that has
 * already settled.
 */
import { invoke } from '@tauri-apps/api/core';

interface PilotWindow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface RefusalControl {
  readonly id: string;
  readonly handle?: number;
  readonly offset: number;
  readonly length: number;
  readonly expected: string;
}

/** The renderer-safe run description the host returns: no paths, plus the run nonce. */
interface RunDescription {
  readonly run: string;
  readonly asset_base: string;
  readonly wasm_url: string;
  readonly header_bytes: number;
  readonly deadline_ms: number;
  readonly windows: readonly PilotWindow[];
  readonly refusals: readonly RefusalControl[];
}

/** How long cooperative cancellation may take before the worker is terminated. */
const CANCEL_GRACE_MS = 5_000;

function status(text: string): void {
  const element = document.getElementById('status');
  if (element !== null) element.textContent = text;
}

async function main(): Promise<void> {
  const description = (await invoke('pilot_input')) as RunDescription;
  const nonce = description.run;
  status('admitting fixtures');
  const fixtures = (await invoke('admit_fixtures', { nonce })) as {
    fixture: string;
    handle: number;
    length: number;
  }[];
  const target = fixtures[0];
  if (target === undefined) throw new Error('no fixture was admitted');

  status('starting worker');
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let deadlineTimer: number | undefined;

  /** The one terminal path for this run: stop the worker, then publish what happened. */
  const finishOnce = async (payload: unknown): Promise<void> => {
    if (settled) return;
    settled = true;
    if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
    try {
      await worker.terminate();
    } catch {
      // A worker that will not terminate cannot hold the run open: the host owns the
      // process, and the launcher stops it at its own hard deadline.
    }
    status('writing evidence');
    const path = await invoke('finish', { nonce, evidence: payload });
    status(`evidence written: ${String(path)}`);
    document.title = 'Qualification Desktop Host — finished';
  };

  const finished = new Promise<unknown>((done, fail) => {
    let failed = false;
    const settleFailure = (message: string): void => {
      if (failed || settled) return;
      failed = true;
      fail(new Error(message));
    };

    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data as {
        type: 'read' | 'done' | 'error' | 'cancelled';
        run?: string;
        handle?: number;
        offset?: number;
        length?: number;
        requestId?: string;
        result?: unknown;
        message?: string;
      };
      // A message that names another run cannot act on this one.
      if (message.run !== undefined && message.run !== nonce) return;
      if (message.type === 'read') {
        try {
          const reply = (await invoke('read', {
            nonce,
            handle: message.handle,
            offset: message.offset,
            length: message.length,
            requestId: message.requestId,
          })) as { bytes: number[] };
          const bytes = Uint8Array.from(reply.bytes);
          // Transferred, not copied: the worker owns these bytes from here on.
          worker.postMessage({ type: 'bytes', run: nonce, requestId: message.requestId, bytes }, [
            bytes.buffer,
          ]);
        } catch (error) {
          const failure = error as { code?: string };
          worker.postMessage({
            type: 'failed',
            run: nonce,
            requestId: message.requestId,
            code: failure.code ?? 'native-read-failed',
          });
        }
        return;
      }
      if (message.type === 'done') {
        if (!failed && !settled) done(message.result);
        return;
      }
      if (message.type === 'error') {
        settleFailure(message.message ?? 'worker failed');
        return;
      }
      if (message.type === 'cancelled') settleFailure('the worker was cancelled');
    };

    worker.onerror = (event: ErrorEvent) => settleFailure(`worker error: ${event.message}`);
    worker.onmessageerror = () => settleFailure('the worker sent a message that could not be deserialized');

    // Cooperative cancellation: the worker stops scheduling at once, and only a worker
    // that has not released within the grace period is terminated and failed.
    const cancel = (reason: string): void => {
      if (settled || failed) return;
      worker.postMessage({ type: 'cancel', run: nonce });
      window.setTimeout(() => {
        if (!settled && !failed) settleFailure(`${reason}: the worker did not release within ${CANCEL_GRACE_MS} ms`);
      }, CANCEL_GRACE_MS);
    };
    deadlineTimer = window.setTimeout(
      () => cancel(`the run exceeded its ${description.deadline_ms} ms cooperative deadline`),
      description.deadline_ms,
    );
  });

  try {
    worker.postMessage({
      type: 'run',
      run: nonce,
      handle: target.handle,
      headerBytes: description.header_bytes,
      assetBase: description.asset_base,
      wasmUrl: description.wasm_url,
      windows: description.windows,
      refusals: description.refusals,
    });
    const result = await finished;
    await finishOnce(result);
  } catch (error) {
    // A failed pilot still returns honest evidence: the failure is recorded on the host
    // side so the launcher reports a measured failure rather than a missing file.
    status(`failed: ${String(error)}`);
    await finishOnce({ error: String(error) });
  }
}

// A failure before the run nonce is known cannot publish evidence — the host refuses a
// request that does not name its run — so it is reported on the page and in the host log.
main().catch((error: unknown) => {
  status(`failed before the run started: ${String(error)}`);
});
