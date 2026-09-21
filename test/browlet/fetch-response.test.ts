import { describe, expect, it } from 'vitest';

import { Browlet } from '../../src/browlet/browlet';

describe('Fetch Response construction', () => {
  it('constructs a default response with a nullable body and mutable headers', () => {
    const window = createWindow();
    const response = new window.Response();
    expect(response).toMatchObject({
      type: 'default', url: '', redirected: false, status: 200, statusText: '', ok: true,
      body: null, bodyUsed: false,
    });
    expect(response.headers).toBeInstanceOf(window.Headers);
    expect(response.headers).toBe(response.headers);
    response.headers.set('X-Test', 'value');
    response.headers.set('Set-Cookie', 'forbidden');
    expect([...response.headers]).toEqual([['x-test', 'value']]);
    expect(new window.Response(undefined, undefined).status).toBe(200);
  });

  it('extracts a body, fills headers, and honors an explicitly supplied content type', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const response = new Response('payload', {
        status: 201, statusText: 'Created', headers: { 'Content-Type': 'custom/type', 'Set-Cookie': 'forbidden' },
      });
      return {
        status: response.status, statusText: response.statusText, ok: response.ok,
        contentType: response.headers.get('Content-Type'), cookie: response.headers.get('Set-Cookie'),
        text: await response.text(), bodyUsed: response.bodyUsed,
        defaultType: new Response('').headers.get('Content-Type'),
      };
    })).toEqual({
      status: 201, statusText: 'Created', ok: true, contentType: 'custom/type', cookie: null,
      text: 'payload', bodyUsed: true, defaultType: 'text/plain;charset=UTF-8',
    });
  });

  it.each([0, 199, 600, NaN, Infinity])('rejects status %s after Web IDL conversion', (status) => {
    const window = createWindow();
    expect(() => new window.Response(null, { status })).toThrow(window.RangeError);
  });

  it('uses unsigned-short conversion and validates the HTTP reason phrase', () => {
    const window = createWindow();
    expect(new window.Response(null, { status: 65536 + 201 }).status).toBe(201);
    expect(new window.Response(null, { statusText: '\tOK \x80\xff' }).statusText).toBe('\tOK \x80\xff');
    for (const statusText of ['line\rbreak', 'line\nbreak', '\0', '\x7f', '\u0100']) {
      expect(() => new window.Response(null, { statusText })).toThrow(window.TypeError);
    }
  });

  it.each([204, 205, 304])('permits a null body and rejects even an empty body at status %s', (status) => {
    const window = createWindow();
    expect(new window.Response(null, { status }).body).toBeNull();
    expect(() => new window.Response('', { status })).toThrow(window.TypeError);
    expect(() => window.Response.json(null, { status })).toThrow(window.TypeError);
  });

  it('rejects locked streams during extraction before validating response status', () => {
    const window = createWindow();
    const body = new window.ReadableStream();
    const reader = body.getReader();
    expect(() => new window.Response(body, { status: 0 })).toThrow(window.TypeError);
    reader.releaseLock();
    expect(new window.Response(body).body).toBe(body);
  });
});

describe('Fetch Response factories', () => {
  it('creates distinct immutable network-error responses', () => {
    const window = createWindow();
    const response = window.Response.error();
    expect(response).toMatchObject({ type: 'error', status: 0, statusText: '', ok: false, body: null });
    expect(response).not.toBe(window.Response.error());
    expect(() => response.headers.set('X-Test', 'value')).toThrow(window.TypeError);
    expect(() => response.clone().headers.set('X-Test', 'value')).toThrow(window.TypeError);
  });

  it('resolves redirect URLs against the factory realm and keeps headers immutable', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://example.test/dir/page');
    const window = browlet.window as Window & typeof globalThis;
    const response = window.Response.redirect('../next#fragment');
    expect(response).toMatchObject({ type: 'default', status: 302, url: '', redirected: false, body: null });
    expect(response.headers.get('Location')).toBe('https://example.test/next#fragment');
    expect(() => response.headers.delete('Location')).toThrow(window.TypeError);
    for (const status of [301, 302, 303, 307, 308]) {
      expect(window.Response.redirect('/next', status).status).toBe(status);
    }
    expect(() => window.Response.redirect('https://[', 200)).toThrow(window.TypeError);
    expect(() => window.Response.redirect('/next', 200)).toThrow(window.RangeError);
  });

  it('serializes JSON before initialization and respects explicit response headers', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const response = Response.json({ text: 'é', list: [1, true, null] }, { status: 202 });
      const custom = Response.json(null, { headers: { 'Content-Type': 'custom/type' } });
      return {
        status: response.status, type: response.headers.get('Content-Type'), text: await response.text(),
        customType: custom.headers.get('Content-Type'), customText: await custom.text(),
      };
    })).toEqual({
      status: 202, type: 'application/json', text: '{"text":"é","list":[1,true,null]}',
      customType: 'custom/type', customText: 'null',
    });
  });

  it('rejects unserializable JSON in the factory realm and preserves author exceptions', () => {
    const window = createWindow();
    const cyclic: { self?: unknown; } = {};
    cyclic.self = cyclic;
    for (const value of [undefined, () => {}, Symbol(), 1n, cyclic]) {
      expect(() => window.Response.json(value)).toThrow(window.TypeError);
    }
    const reason = {};
    let thrown: unknown;
    try {
      window.Response.json({
        toJSON() {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- An author's toJSON may throw any value.
          throw reason;
        },
      }, { status: 0 });
    } catch (error) { thrown = error; }
    expect(thrown).toBe(reason);
  });

  it('uses the captured JSON serializer while still honoring toJSON', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      JSON.stringify = () => 'replaced';
      const response = Response.json({ toJSON() { return { original: true }; } });
      return await response.text();
    })).toBe('{"original":true}');
  });
});

describe('Fetch Response cloning and realm ownership', () => {
  it('tees a body, copies headers, and permits independent consumption', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const response = new Response('payload', { status: 201 });
      const clone = response.clone();
      clone.headers.set('X-Test', 'clone');
      const before = [response.bodyUsed, clone.bodyUsed, response.body!.locked, clone.body!.locked];
      return {
        before, status: clone.status, originalHeader: response.headers.get('X-Test'),
        texts: await Promise.all([response.text(), clone.text()]),
      };
    })).toEqual({ before: [false, false, false, false], status: 201, originalHeader: null, texts: ['payload', 'payload'] });
  });

  it('rejects cloning locked and disturbed bodies', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(async () => {
      const response = new Response('payload');
      const reader = response.body!.getReader();
      const rejected: boolean[] = [];
      try { response.clone(); rejected.push(false); } catch (error) { rejected.push(error instanceof TypeError); }
      reader.releaseLock();
      await response.text();
      try { response.clone(); rejected.push(false); } catch (error) { rejected.push(error instanceof TypeError); }
      return rejected;
    })).toEqual([true, true]);
  });

  it('allocates borrowed clones in the receiver realm and static results in the method realm', () => {
    const owner = createWindow();
    const other = createWindow();
    const response = new owner.Response('payload');
    const clone = other.Response.prototype.clone.call(response);
    expect(clone).toBeInstanceOf(owner.Response);
    expect(clone.body).toBeInstanceOf(owner.ReadableStream);
    expect(clone.headers).toBeInstanceOf(owner.Headers);
    const error = other.Response.error.call(owner.Response);
    expect(error).toBeInstanceOf(other.Response);
    expect(error.headers).toBeInstanceOf(other.Headers);
    const json = other.Response.json.call(owner.Response, { value: true });
    expect(json).toBeInstanceOf(other.Response);
    expect(json.body).toBeInstanceOf(other.ReadableStream);
    expect(() => other.Response.prototype.clone.call({} as Response)).toThrow(other.TypeError);
  });

  it('honors subclass construction and returns ordinary Responses from factories and clone', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      class CustomResponse extends Response {}
      const response = new CustomResponse();
      return {
        subclass: response instanceof CustomResponse, cloneSubclass: response.clone() instanceof CustomResponse,
        errorSubclass: CustomResponse.error() instanceof CustomResponse,
        jsonSubclass: CustomResponse.json(null) instanceof CustomResponse,
        constructorLength: Response.length,
      };
    })).toEqual({ subclass: true, cloneSubclass: false, errorSubclass: false, jsonSubclass: false, constructorLength: 0 });
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as Window & typeof globalThis;
}
