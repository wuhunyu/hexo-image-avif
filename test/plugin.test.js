'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { register } = require('../index');

function fakeHexo(command, imageAvifConfig = {}) {
  const filters = new Map();
  const filterPriorities = new Map();
  const consoles = new Map();
  return {
    env: { cmd: command },
    config: { image_avif: imageAvifConfig },
    extend: {
      filter: {
        register(name, fn, priority) {
          filters.set(name, fn);
          filterPriorities.set(name, priority);
        },
      },
      console: {
        register(name, description, fn) { consoles.set(name, { description, fn }); },
      },
    },
    filters,
    filterPriorities,
    consoles,
  };
}

test('runs image processing from after_init for g and generate commands', async () => {
  for (const command of ['g', 'generate']) {
    const hexo = fakeHexo(command);
    let calls = 0;
    register(hexo, { processImages: async received => { calls++; assert.equal(received, hexo); } });

    assert.equal(typeof hexo.filters.get('after_init'), 'function');
    await hexo.filters.get('after_init')();
    assert.equal(calls, 1);
  }
});

test('registers after_init early by default and supports custom priority', () => {
  const defaultHexo = fakeHexo('generate');
  register(defaultHexo, { processImages: async () => {} });
  assert.equal(defaultHexo.filterPriorities.get('after_init'), 0);

  const customHexo = fakeHexo('generate', { priority: -50 });
  register(customHexo, { processImages: async () => {} });
  assert.equal(customHexo.filterPriorities.get('after_init'), -50);
});

test('does not auto-run image processing for unrelated commands', async () => {
  const hexo = fakeHexo('server');
  let calls = 0;
  register(hexo, { processImages: async () => { calls++; } });
  await hexo.filters.get('after_init')();
  assert.equal(calls, 0);
});

test('registers hexo images and invokes the same processor', async () => {
  const hexo = fakeHexo('images');
  let calls = 0;
  register(hexo, { processImages: async received => { calls++; assert.equal(received, hexo); return { converted: 1 }; } });

  const command = hexo.consoles.get('images');
  assert.equal(typeof command.fn, 'function');
  assert.match(command.description, /AVIF/i);
  const result = await command.fn();
  assert.equal(calls, 1);
  assert.deepEqual(result, { converted: 1 });
});
