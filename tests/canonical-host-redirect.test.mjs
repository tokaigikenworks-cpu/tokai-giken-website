import assert from 'node:assert/strict';
import test from 'node:test';

const { onRequest } = await import('../functions/_middleware.js');

async function invoke(url) {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request(url),
    next: async () => {
      nextCalls += 1;
      return new Response('next');
    },
  });

  return { response, nextCalls };
}

test('redirects the www host directly to the canonical HTTPS host', async () => {
  const { response, nextCalls } = await invoke('https://www.tokai-giken.com/process?source=test');

  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://tokai-giken.com/process?source=test');
  assert.equal(nextCalls, 0);
});

test('passes canonical-host requests through without redirecting', async () => {
  const { response, nextCalls } = await invoke('https://tokai-giken.com/process');

  assert.equal(response.status, 200);
  assert.equal(nextCalls, 1);
});
