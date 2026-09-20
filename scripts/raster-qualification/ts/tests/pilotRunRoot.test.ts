/**
 * Run-root ownership, atomic publication and foreign-resource preservation.
 *
 * These cases exercise the real modules the launcher uses, not a re-implementation:
 * `createRunRoot`, `publishRunArtifacts` (through the no-replace primitive the
 * evaluator itself publishes with) and the X11 relay policy. The socket cases use a
 * temporary socket root, so no real display socket is ever touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect, type Server } from 'node:net';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createRunLog, createRunRoot } from '../src/pilot/runRoot.js';
import { publishRunArtifacts } from '../src/pilot/artifacts.js';
import { localDisplayNumber, prepareX11Relay } from '../src/pilot/x11.js';
import { publicationFaultInjection } from '../src/publication.js';
import { TempRoot } from './helpers.js';

function root(tag: string): { readonly temp: TempRoot; readonly requested: string } {
  const temp = new TempRoot();
  return { temp, requested: join(temp.path, tag) };
}

test('an existing directory of any kind is refused untouched', () => {
  const temp = new TempRoot();
  try {
    // A directory holding only an old q2 report: the exact shape the three-filename
    // heuristic used to accept.
    const held = join(temp.path, 'run');
    mkdirSync(held);
    const report = join(held, 'q2-numeric.json');
    writeFileSync(report, '{"result":"pass"}\n', 'utf8');
    const before = readFileSync(report);

    const refused = createRunRoot(held);
    assert.equal(refused.ok, false);
    assert.match(refused.ok === false ? refused.problems.join(' ') : '', /already exists/);
    assert.deepEqual(readFileSync(report), before, 'the existing report must be byte-for-byte intact');
    assert.deepEqual(readdir(held), ['q2-numeric.json'], 'nothing may be added to the refused directory');

    // An existing empty directory is refused too: it is proof that something already
    // selected this root.
    const empty = join(temp.path, 'empty');
    mkdirSync(empty);
    const refusedEmpty = createRunRoot(empty);
    assert.equal(refusedEmpty.ok, false);
    assert.deepEqual(readdir(empty), []);

    // A symlink to a directory is an existing destination, so it is refused rather
    // than followed, and the target is untouched.
    const target = join(temp.path, 'target');
    mkdirSync(target);
    const link = join(temp.path, 'link');
    symlinkSync(target, link);
    const refusedLink = createRunRoot(link);
    assert.equal(refusedLink.ok, false);
    assert.deepEqual(readdir(target), []);

    // A dangling symlink is refused as well: publishing through it would create the
    // target it names.
    const dangling = join(temp.path, 'dangling');
    symlinkSync(join(temp.path, 'nowhere'), dangling);
    const refusedDangling = createRunRoot(dangling);
    assert.equal(refusedDangling.ok, false);
    assert.equal(existsSync(join(temp.path, 'nowhere')), false);
  } finally {
    temp.cleanup();
  }
});

test('a directory created while the run was starting is refused, not adopted', () => {
  const temp = new TempRoot();
  try {
    const requested = join(temp.path, 'raced');
    const result = createRunRoot(requested, {
      beforeCreate: () => {
        mkdirSync(requested);
        writeFileSync(join(requested, 'q2-numeric.json'), '{"result":"pass"}\n', 'utf8');
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.problems.join(' ') : '', /created by something else while this run was starting/);
    assert.deepEqual(readdir(requested), ['q2-numeric.json']);
  } finally {
    temp.cleanup();
  }
});

test('a run root that cannot be created is reported without side effects', () => {
  const temp = new TempRoot();
  try {
    const result = createRunRoot(join(temp.path, 'absent-parent', 'run'));
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.problems.join(' ') : '', /parent directory .* does not exist/);
    assert.equal(existsSync(join(temp.path, 'absent-parent')), false);
  } finally {
    temp.cleanup();
  }
});

test('artifacts are published whole and never replace what exists', () => {
  const temp = new TempRoot();
  try {
    const created = createRunRoot(join(temp.path, 'run'));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const { root: runRoot } = created;

    const first = publishRunArtifacts(runRoot, [
      { name: 'q2-numeric.json', document: { result: 'pass', windows: [1, 2, 3] } },
      { name: 'host.json', document: { result: 'pass' } },
    ]);
    assert.deepEqual(first.problems, []);
    assert.deepEqual(first.published, ['q2-numeric.json', 'host.json']);
    assert.match(readFileSync(join(runRoot.path, 'q2-numeric.json'), 'utf8'), /"result": "pass"/);

    // A second publication of the same artifact refuses and leaves the first intact.
    const second = publishRunArtifacts(runRoot, [{ name: 'q2-numeric.json', document: { result: 'fail' } }]);
    assert.equal(second.published.length, 0);
    assert.equal(second.problems.length, 1);
    assert.match(second.problems[0] ?? '', /already exists/);
    assert.match(readFileSync(join(runRoot.path, 'q2-numeric.json'), 'utf8'), /"result": "pass"/);

    // A name that is not one plain file inside the root is refused.
    const escaping = publishRunArtifacts(runRoot, [{ name: '../escape.json', document: {} }]);
    assert.equal(escaping.published.length, 0);
    assert.match(escaping.problems[0] ?? '', /one plain file inside the run root/);
    assert.equal(existsSync(join(temp.path, 'escape.json')), false);
  } finally {
    temp.cleanup();
  }
});

test('a failed link leaves no published partial artifact, and stops the run', () => {
  const temp = new TempRoot();
  try {
    const created = createRunRoot(join(temp.path, 'run'));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const { root: runRoot } = created;
    const destination = join(runRoot.path, 'host-evidence.json');
    writeFileSync(destination, '{"foreign":true}\n', 'utf8');

    publicationFaultInjection.beforeLink = (destination) => {
      if (destination.endsWith('host-evidence.json')) throw new Error('injected link failure');
    };
    try {
      const publication = publishRunArtifacts(runRoot, [
        { name: 'q2-numeric.json', document: { result: 'pass' } },
        { name: 'host-evidence.json', document: { result: 'pass' } },
        { name: 'pilot-result.json', document: { result: 'pass' } },
      ]);
      assert.deepEqual(publication.published, ['q2-numeric.json']);
      assert.equal(publication.problems.length, 1);
      assert.match(publication.problems[0] ?? '', /injected link failure/);
      assert.deepEqual(readdir(runRoot.path).filter((entry) => entry.startsWith('.q-stage-')), []);
      assert.equal(existsSync(join(runRoot.path, 'pilot-result.json')), false, 'a failure must stop the remaining artifacts');
      assert.equal(readFileSync(destination, 'utf8'), '{"foreign":true}\n', 'the existing file is untouched');
    } finally {
      delete publicationFaultInjection.beforeLink;
    }
    // The staging directory the failed publication created is cleaned up, so a failed
    // run does not leave half-written documents behind.
    assert.equal(
      readdir(runRoot.path).some((entry) => entry.startsWith('.q-stage-')),
      false,
      'no staging directory may survive a failed publication',
    );
  } finally {
    temp.cleanup();
  }
});

test('the run log is exclusive, bounded and closed', () => {
  const temp = new TempRoot();
  try {
    const path = join(temp.path, 'host.log');
    const log = createRunLog(path, 32);
    assert.throws(() => createRunLog(path, 32), /EEXIST/, 'the log is created exclusively');
    log.write('0123456789');
    log.write('0123456789');
    log.write('0123456789');
    log.write('0123456789');
    assert.equal(log.bytesWritten, 32);
    assert.equal(log.truncated, true);
    log.close();
    const contents = readFileSync(path, 'utf8');
    assert.equal(contents.split('\n')[0], '01234567890123456789012345678901');
    assert.match(contents, /log truncated at 32 bytes/);
    assert.ok(contents.length < 80, 'the log stays bounded');
  } finally {
    temp.cleanup();
  }
});

test('a reachable foreign X11 socket is reused and never removed', async () => {
  const temp = new TempRoot();
  const socketRoot = join(temp.path, 'x11');
  mkdirSync(socketRoot, { recursive: true });
  const path = join(socketRoot, 'X7');
  // A server that answers nothing: the probe only asks whether a socket is there.
  const server = createServer((client) => client.on('error', () => client.destroy()));
  try {
    await new Promise<void>((resolve) => server.listen(path, () => resolve()));
    const result = await prepareX11Relay(':7', { socketRoot });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.relay.reused, true);
    assert.equal(result.relay.owned, false);
    assert.equal(result.relay.path, path);
    const released = result.relay.release();
    assert.deepEqual(released.problems, []);
    assert.equal(existsSync(path), true, 'a foreign socket must survive release');
  } finally {
    server.close();
    temp.cleanup();
  }
});

test('an existing socket nobody answers on is a prerequisite failure, not a deletion', async () => {
  const temp = new TempRoot();
  const socketRoot = join(temp.path, 'x11');
  mkdirSync(socketRoot, { recursive: true });
  const path = join(socketRoot, 'X8');
  writeFileSync(path, 'not a socket');
  try {
    const result = await prepareX11Relay(':8', { socketRoot });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.problems.join(' ') : '', /does not answer/);
    assert.equal(existsSync(path), true, 'the unreachable socket must be left in place');
  } finally {
    temp.cleanup();
  }
});

test('an owned relay forwards traffic and is removed on release', async () => {
  const temp = new TempRoot();
  const socketRoot = join(temp.path, 'x11');
  mkdirSync(socketRoot, { recursive: true });
  const displayPath = join(socketRoot, 'X9');
  // The abstract socket the relay forwards to, standing in for the X server.
  const upstream = createServer((client) => {
    client.on('data', (chunk) => client.write(chunk));
  });
  await new Promise<void>((resolve) => upstream.listen(`\0${displayPath}`, () => resolve()));
  try {
    const result = await prepareX11Relay(':9', { socketRoot });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.relay.owned, true);
    assert.equal(result.relay.reused, false);
    const inode = lstatSync(displayPath).ino;

    const echoed = await new Promise<string>((resolve, reject) => {
      const client = connect({ path: displayPath });
      client.once('error', reject);
      client.once('connect', () => client.write('hello display'));
      client.once('data', (chunk) => {
        client.end();
        resolve(chunk.toString());
      });
    });
    assert.equal(echoed, 'hello display');

    const released = result.relay.release();
    assert.deepEqual(released.problems, []);
    assert.equal(existsSync(displayPath), false, 'the relay it created is removed');
    assert.equal(inode > 0, true);
  } finally {
    upstream.close();
    temp.cleanup();
  }
});

test('a relay socket replaced before release is left alone and reported', async () => {
  const temp = new TempRoot();
  const socketRoot = join(temp.path, 'x11');
  mkdirSync(socketRoot, { recursive: true });
  const displayPath = join(socketRoot, 'X10');
  const upstream = createServer();
  await new Promise<void>((resolve) => upstream.listen(`\0${displayPath}`, () => resolve()));
  const replacement = createServer();
  try {
    const result = await prepareX11Relay(':10', { socketRoot });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    rmSync(displayPath);
    await new Promise<void>((resolve) => replacement.listen(displayPath, () => resolve()));

    const released = result.relay.release();
    assert.equal(released.ok, false);
    assert.match(released.problems.join(' '), /left in place and the relay listener was abandoned/);
    assert.equal(existsSync(displayPath), true, 'the replacement must survive');
  } finally {
    replacement.close();
    upstream.close();
    temp.cleanup();
  }
});

test('a remote DISPLAY has no local socket to relay', () => {
  assert.equal(localDisplayNumber(':0'), 0);
  assert.equal(localDisplayNumber('unix:1.0'), 1);
  assert.equal(localDisplayNumber('workstation:2'), undefined);
  assert.equal(localDisplayNumber('nonsense'), undefined);
});

function readdir(path: string): string[] {
  return readdirSync(path).sort();
}
