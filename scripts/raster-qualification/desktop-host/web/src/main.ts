/**
 * The qualification host's WebView entry.
 *
 * It relays native bounded reads to the bundled worker and transfers the returned
 * buffers, and it reports the worker's result to the host. It does not decode rasters,
 * does not choose a path, and does not write a report.
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

interface PilotInput {
  readonly run: string;
  readonly run_directory: string;
  readonly asset_base: string;
  readonly wasm_url: string;
  readonly header_bytes: number;
  readonly windows: readonly PilotWindow[];
  readonly refusals: readonly RefusalControl[];
}

function status(text: string): void {
  const element = document.getElementById('status');
  if (element !== null) element.textContent = text;
}

async function main(): Promise<void> {
  const input = (await invoke('pilot_input')) as PilotInput;
  status('admitting fixtures');
  const fixtures = (await invoke('admit_fixtures')) as { fixture: string; handle: number }[];
  const target = fixtures[0];
  if (target === undefined) throw new Error('no fixture was admitted');

  status('starting worker');
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const finished = new Promise<unknown>((done, fail) => {
    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data as {
        type: 'read' | 'done' | 'error';
        handle?: number;
        offset?: number;
        length?: number;
        requestId?: string;
        result?: unknown;
        message?: string;
      };
      if (message.type === 'read') {
        try {
          const reply = (await invoke('read', {
            handle: message.handle,
            offset: message.offset,
            length: message.length,
            requestId: message.requestId,
            label: 'candidate',
          })) as { bytes: number[] };
          worker.postMessage({
            type: 'bytes',
            requestId: message.requestId,
            bytes: Uint8Array.from(reply.bytes),
          });
        } catch (error) {
          const failure = error as { code?: string };
          worker.postMessage({
            type: 'failed',
            requestId: message.requestId,
            code: failure.code ?? 'native-read-failed',
          });
        }
        return;
      }
      if (message.type === 'done') {
        done(message.result);
        return;
      }
      fail(new Error(message.message ?? 'worker failed'));
    };
  });

  // The run spec crosses the bridge in its authored form (the same keys the launcher
  // writes to `run-spec.json`); the worker's message uses its own camelCase interface.
  worker.postMessage({
    type: 'run',
    handle: target.handle,
    run: input.run,
    headerBytes: input.header_bytes,
    assetBase: input.asset_base,
    wasmUrl: input.wasm_url,
    windows: input.windows,
    refusals: input.refusals,
  });
  const result = await finished;
  status('writing evidence');
  const path = await invoke('finish', { evidence: result });
  status(`evidence written: ${String(path)}`);
  document.title = 'Qualification Desktop Host — finished';
}

main().catch(async (error: unknown) => {
  // A failed pilot still returns honest evidence: the failure is recorded on the host
  // side so the launcher can report a measured failure rather than a missing file.
  status(`failed: ${String(error)}`);
  try {
    await invoke('finish', { evidence: { error: String(error) } });
  } catch {
    // Nothing further can be recorded; the host console carries the failure.
  }
});
