import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/json.js';

test('a well-formed document parses to its value', () => {
  const result = parseJson('{"a": [1, 2, {"b": "c"}]}', 'doc');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { a: [1, 2, { b: 'c' }] });
});

test('a repeated object key is rejected before decoding can lose it', () => {
  const result = parseJson('{"a": 1, "a": 2}', 'doc');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problem, /repeats object key\(s\): a/);
});

test('a repeated key nested inside an array element is rejected', () => {
  const result = parseJson('{"list": [{"k": 1, "k": 2}]}', 'doc');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problem, /repeats object key\(s\): k/);
});

test('the same key in two sibling objects is not a duplicate', () => {
  const result = parseJson('[{"k": 1}, {"k": 2}]', 'doc');
  assert.equal(result.ok, true);
});

test('a brace inside a string does not confuse the walk', () => {
  const result = parseJson('{"a": "}{", "b": 1}', 'doc');
  assert.equal(result.ok, true);
});

test('an escaped quote inside a string does not confuse the walk', () => {
  const result = parseJson('{"a": "he said \\"x\\"", "b": 1}', 'doc');
  assert.equal(result.ok, true);
});

test('non-finite numeric tokens are rejected', () => {
  for (const token of ['NaN', 'Infinity', '-Infinity']) {
    const result = parseJson(`{"generatedAt": ${token}}`, 'bundle');
    assert.equal(result.ok, false, `${token} was accepted`);
    if (!result.ok) assert.match(result.problem, /not a finite JSON number/);
  }
});

test('the literal text NaN inside a string is not rejected', () => {
  const result = parseJson('{"note": "NaN"}', 'doc');
  assert.equal(result.ok, true);
});

test('malformed JSON reports the label and does not throw', () => {
  const result = parseJson('{"a": ', 'report');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problem, /^report is malformed JSON/);
});

test('trailing content is rejected', () => {
  const result = parseJson('{"a": 1} extra', 'doc');
  assert.equal(result.ok, false);
});

test('an empty document is rejected', () => {
  const result = parseJson('', 'doc');
  assert.equal(result.ok, false);
});
