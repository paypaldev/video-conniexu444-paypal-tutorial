import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alreadyOwnsSet, mergeOwned } from '../src/lib/owned.js';

describe('mergeOwned', () => {
  it('keeps an optimistic grant the server has not echoed yet', () => {
    const owned = mergeOwned(['algebra'], ['geometry']);
    assert.equal(owned.has('algebra'), true);
    assert.equal(owned.has('geometry'), true);
  });

  it('does not drop other server grants', () => {
    const owned = mergeOwned(['algebra', 'advanced'], []);
    assert.deepEqual([...owned].sort(), ['advanced', 'algebra']);
  });

  it('is a no-op when the server already agrees', () => {
    const owned = mergeOwned(['geometry'], ['geometry']);
    assert.equal(owned.size, 1);
    assert.equal(owned.has('geometry'), true);
  });
});

describe('alreadyOwnsSet', () => {
  it('recognises the create-order 409', () => {
    assert.equal(alreadyOwnsSet('You already own this set.'), true);
  });

  it('does not treat a missing price as already owned', () => {
    assert.equal(alreadyOwnsSet('That set has no price set.'), false);
  });

  it('does not treat a free set as already owned', () => {
    assert.equal(alreadyOwnsSet('That set is already free.'), false);
  });
});
