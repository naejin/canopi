/**
 * The X11 pathname socket, and the relay a network namespace needs.
 *
 * A network namespace isolates the X server's *abstract* socket, so a denied-network
 * pilot reaches the display through the *pathname* socket instead. That socket may
 * already exist and belong to somebody else, so it is treated as a foreign resource:
 *
 * * an existing socket that answers is used read-only and never removed;
 * * an existing socket that does not answer is a prerequisite failure — deleting it
 *   could destroy a display another process is about to use;
 * * a relay is created only by binding a path that does not exist, and only that
 *   exact socket is removed afterwards;
 * * if the path changed between binding and release, cleanup is reported as failed
 *   and the path is left alone.
 *
 * Tests point this module at a temporary socket root; nothing here ever touches a
 * real user's display socket except to connect to it.
 */

import { createServer, connect, type Server } from 'node:net';
import { lstatSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where X servers keep their pathname sockets. */
export const DEFAULT_SOCKET_ROOT = '/tmp/.X11-unix';

export interface X11Relay {
  /** True when a display path is usable for the child. */
  readonly ready: boolean;
  /** The pathname the child connects to. */
  readonly path?: string;
  /** The abstract socket name this relay forwards to, when it owns a relay. */
  readonly target?: string;
  /** True when this invocation bound the socket and must remove it. */
  readonly owned: boolean;
  /** True when an existing reachable socket was reused without being modified. */
  readonly reused: boolean;
  readonly detail: string;
  /** Close the relay and remove only the socket this invocation created. */
  readonly release: () => { readonly ok: boolean; readonly problems: readonly string[] };
}

export type X11Result =
  | { readonly ok: true; readonly relay: X11Relay }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The display number of a local `DISPLAY`, or undefined when it is not local. */
export function localDisplayNumber(display: string): number | undefined {
  const separator = display.indexOf(':');
  if (separator === -1) return undefined;
  const host = display.slice(0, separator);
  if (host !== '' && host !== 'unix') return undefined;
  const number = Number.parseInt(display.slice(separator + 1).split('.')[0] ?? '', 10);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether something is listening on a pathname socket. */
async function reachable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect({ path });
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => {
      probe.destroy();
      resolve(false);
    });
  });
}

export interface X11Options {
  /** The socket directory; tests use a temporary one. */
  readonly socketRoot?: string;
}

/**
 * Prepare the display path this run needs.
 *
 * A `DISPLAY` that is not local has no pathname socket to relay, which is reported
 * rather than guessed at: this instrument only knows how to keep a local display
 * reachable inside a network namespace.
 */
export async function prepareX11Relay(display: string, options: X11Options = {}): Promise<X11Result> {
  const number = localDisplayNumber(display);
  if (number === undefined) {
    return {
      ok: false,
      problems: [
        `network denial isolates the display's abstract socket, and DISPLAY=${JSON.stringify(display)} names no local display to relay`,
      ],
    };
  }
  const socketRoot = options.socketRoot ?? DEFAULT_SOCKET_ROOT;
  const path = join(socketRoot, `X${number}`);
  const target = `\0${path}`;

  try {
    lstatSync(path);
  } catch {
    return bindOwnRelay(path, target, socketRoot, number);
  }

  if (await reachable(path)) {
    return {
      ok: true,
      relay: {
        ready: true,
        path,
        target,
        owned: false,
        reused: true,
        detail: `reused the existing X11 socket ${path} without modifying it`,
        release: () => ({ ok: true, problems: [] }),
      },
    };
  }
  return {
    ok: false,
    problems: [
      `${path} exists but does not answer, so this run will not remove or replace a socket it does not own`,
    ],
  };
}

/** Bind a relay at a path this invocation has established is absent. */
async function bindOwnRelay(
  path: string,
  target: string,
  socketRoot: string,
  number: number,
): Promise<X11Result> {
  try {
    mkdirSync(socketRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    return { ok: false, problems: [`cannot create ${socketRoot}: ${detail(error)}`] };
  }

  const connections = new Set<ReturnType<typeof connect>>();
  const server: Server = createServer((client) => {
    const upstream = connect({ path: target });
    connections.add(upstream);
    upstream.on('close', () => connections.delete(upstream));
    client.on('error', () => client.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => resolve());
    });
  } catch (error) {
    server.close();
    return {
      ok: false,
      problems: [`cannot bind the X11 relay at ${path}: ${detail(error)}`],
    };
  }

  let inode: number;
  try {
    inode = statSync(path).ino;
  } catch (error) {
    server.close();
    return { ok: false, problems: [`cannot establish ownership of the X11 relay ${path}: ${detail(error)}`] };
  }

  // The relay must not hold the launcher open: the child's lifetime decides when the
  // run ends, and release() closes it explicitly on every terminal path.
  server.unref();

  return {
    ok: true,
    relay: {
      ready: true,
      path,
      target,
      owned: true,
      reused: false,
      detail: `bound a local X11 relay at ${path} for display :${number}`,
      release: () => {
        const problems: string[] = [];
        for (const connection of connections) connection.destroy();
        connections.clear();
        // Node unlinks the bound path when the server closes, without checking who
        // owns it now. So ownership is re-established *before* closing: if the path is
        // no longer this run's socket, the listener is abandoned instead of risking
        // the removal of a socket this run does not own.
        let owned = false;
        try {
          owned = statSync(path).ino === inode;
        } catch {
          owned = false;
        }
        if (!owned) {
          problems.push(
            `the X11 relay ${path} is no longer the socket this run bound, so it was left in place and the relay listener was abandoned rather than closing it`,
          );
          return { ok: false, problems };
        }
        try {
          server.close();
        } catch (error) {
          problems.push(`cannot close the X11 relay: ${detail(error)}`);
        }
        return { ok: problems.length === 0, problems };
      },
    },
  };
}
