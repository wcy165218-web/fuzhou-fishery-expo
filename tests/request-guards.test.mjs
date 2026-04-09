import assert from 'node:assert/strict';
import {
  BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT,
  CONTRACT_UPLOAD_BODY_LIMIT,
  DEFAULT_JSON_BODY_LIMIT,
  REQUEST_BODY_INVALID_MESSAGE,
  REQUEST_BODY_TOO_LARGE_MESSAGE,
  enforceRequestBodyHeaderLimit,
  getMaxBodyBytesForPath,
  readFormDataBody,
  readJsonBody
} from '../src/utils/request.mjs';

function createHeaders(input = {}) {
  const entries = Object.entries(input);
  return {
    get(name) {
      const matched = entries.find(([key]) => key.toLowerCase() === String(name).toLowerCase());
      return matched ? matched[1] : null;
    }
  };
}

function createMockRequest({
  method = 'POST',
  headers = {},
  bodyText = '',
  formDataValue = null,
  formDataError = null
} = {}) {
  return {
    method,
    headers: createHeaders(headers),
    async text() {
      return bodyText;
    },
    async formData() {
      if (formDataError) throw formDataError;
      return formDataValue;
    }
  };
}

async function readErrorPayload(response) {
  assert.ok(response instanceof Response);
  const data = await response.json();
  assert.equal(data.success, false);
  return data;
}

async function runTests() {
  const corsHeaders = { 'Access-Control-Allow-Origin': 'http://localhost' };

  assert.equal(getMaxBodyBytesForPath('/api/orders'), DEFAULT_JSON_BODY_LIMIT);
  assert.equal(getMaxBodyBytesForPath('/api/upload'), CONTRACT_UPLOAD_BODY_LIMIT);
  assert.equal(getMaxBodyBytesForPath('/api/upload-booth-map-background'), BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT);

  const ignoredResponse = enforceRequestBodyHeaderLimit(
    createMockRequest({ method: 'GET' }),
    new URL('http://localhost/api/orders'),
    corsHeaders
  );
  assert.equal(ignoredResponse, null);

  const oversizedHeaderResponse = enforceRequestBodyHeaderLimit(
    createMockRequest({
      headers: {
        'content-type': 'application/json',
        'content-length': String(DEFAULT_JSON_BODY_LIMIT + 1)
      }
    }),
    new URL('http://localhost/api/orders'),
    corsHeaders
  );
  assert.equal(oversizedHeaderResponse.status, 413);
  assert.equal((await readErrorPayload(oversizedHeaderResponse)).error, REQUEST_BODY_TOO_LARGE_MESSAGE);

  const oversizedUploadHeaderResponse = enforceRequestBodyHeaderLimit(
    createMockRequest({
      headers: {
        'content-type': 'multipart/form-data; boundary=demo',
        'content-length': String(BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT + 1)
      }
    }),
    new URL('http://localhost/api/upload-booth-map-background'),
    corsHeaders
  );
  assert.equal(oversizedUploadHeaderResponse.status, 413);

  const parsedBody = await readJsonBody(
    createMockRequest({ bodyText: JSON.stringify({ ok: 1, name: 'expo' }) }),
    corsHeaders
  );
  assert.deepEqual(parsedBody, { ok: 1, name: 'expo' });

  const emptyBody = await readJsonBody(createMockRequest({ bodyText: '   ' }), corsHeaders);
  assert.deepEqual(emptyBody, {});

  const oversizedJsonBody = await readJsonBody(
    createMockRequest({
      bodyText: JSON.stringify({ note: 'a'.repeat(DEFAULT_JSON_BODY_LIMIT) })
    }),
    corsHeaders
  );
  assert.equal(oversizedJsonBody.status, 413);
  assert.equal((await readErrorPayload(oversizedJsonBody)).error, REQUEST_BODY_TOO_LARGE_MESSAGE);

  const invalidJsonBody = await readJsonBody(
    createMockRequest({ bodyText: '{invalid-json' }),
    corsHeaders
  );
  assert.equal(invalidJsonBody.status, 400);
  assert.equal((await readErrorPayload(invalidJsonBody)).error, REQUEST_BODY_INVALID_MESSAGE);

  const parsedForm = await readFormDataBody(
    createMockRequest({
      headers: { 'content-length': '128' },
      formDataValue: { ok: true }
    }),
    corsHeaders,
    { maxBytes: 256 }
  );
  assert.deepEqual(parsedForm, { ok: true });

  const oversizedForm = await readFormDataBody(
    createMockRequest({
      headers: { 'content-length': String(CONTRACT_UPLOAD_BODY_LIMIT + 1) },
      formDataValue: { ok: true }
    }),
    corsHeaders,
    { maxBytes: CONTRACT_UPLOAD_BODY_LIMIT }
  );
  assert.equal(oversizedForm.status, 413);
  assert.equal((await readErrorPayload(oversizedForm)).error, REQUEST_BODY_TOO_LARGE_MESSAGE);

  const invalidForm = await readFormDataBody(
    createMockRequest({
      formDataError: new Error('broken form')
    }),
    corsHeaders,
    { maxBytes: 16 }
  );
  assert.equal(invalidForm.status, 400);
  assert.equal((await readErrorPayload(invalidForm)).error, REQUEST_BODY_INVALID_MESSAGE);
}

await runTests();
console.log('Request guard tests passed');
