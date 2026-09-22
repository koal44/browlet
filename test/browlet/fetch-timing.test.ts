import { describe, expect, it } from 'vitest';
import { Clock } from '../../src/browlet/performance/clock';
import { ConnectionTimingInfo } from '../../src/fetch/timing';
import { coarsenTime } from '../../src/infra/time';

describe('Fetch connection timing', () => {
  it.each([
    [false, 12.3], [true, 12.345],
  ] as const)('uses the shared coarsening policy with isolation %s', (isolated, expected) => {
    const moment = new Clock(() => 12.3456).unsafeCurrentTime();

    expect(coarsenTime(moment.milliseconds, isolated)).toBe(expected);
    expect(moment.coarsen(isolated).milliseconds).toBe(expected);
  });

  it('coarsens each new-connection timestamp and preserves the actual TLS start', () => {
    const timing = createTiming();
    const result = timing.clampAndCoarsen(10, false);

    expect(result).toEqual({
      domainLookupStartTime: 10.1, domainLookupEndTime: 10.2, connectionStartTime: 11.3,
      secureConnectionStartTime: 12.4, connectionEndTime: 18.5,
      alpnNegotiatedProtocol: timing.alpnNegotiatedProtocol,
    });
    expect(result).not.toBe(timing);
    expect(result.alpnNegotiatedProtocol).toBe(timing.alpnNegotiatedProtocol);
    expect(timing.secureConnectionStartTime).toBe(12.456);
    expect(timing.connectionEndTime).toBe(18.567);
  });

  it('replaces reused-connection details with the supplied start time without recoarsening it', () => {
    const timing = createTiming();
    const result = timing.clampAndCoarsen(20.123, false);

    expect(result).toEqual({
      domainLookupStartTime: 20.123, domainLookupEndTime: 20.123, connectionStartTime: 20.123,
      secureConnectionStartTime: 20.123, connectionEndTime: 20.123,
      alpnNegotiatedProtocol: timing.alpnNegotiatedProtocol,
    });
    expect(timing.connectionStartTime).toBe(11.345);
  });

  it('coarsens rather than hides a connection starting exactly at the supplied start time', () => {
    const timing = createTiming();
    timing.secureConnectionStartTime = 0;
    const result = timing.clampAndCoarsen(timing.connectionStartTime, true);

    expect(result.domainLookupStartTime).toBe(10.12);
    expect(result.connectionEndTime).toBe(18.565);
    expect(result.secureConnectionStartTime).toBe(0);
  });
});

function createTiming() {
  const timing = new ConnectionTimingInfo();
  timing.domainLookupStartTime = 10.123;
  timing.domainLookupEndTime = 10.234;
  timing.connectionStartTime = 11.345;
  timing.secureConnectionStartTime = 12.456;
  timing.connectionEndTime = 18.567;
  timing.alpnNegotiatedProtocol = Uint8Array.of(0x68, 0x32);
  return timing;
}
