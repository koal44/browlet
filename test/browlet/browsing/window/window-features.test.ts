import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { getRelevantRealm } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('window features', () => {
  it.each([
    ['', []],
    [' , =\t\n\r\f', []],
    ['POPUP, NoOpener=YES, NoReferrer = TRUE', [['popup', '']]],
    ['a b=c', [['a', ''], ['b', 'c']]],
    ['a= b=c', [['a', 'b'], ['c', '']]],
    ['a=,b=2,', [['a', ''], ['b', '2']]],
    ['a==1 b = = 2', [['a', '1'], ['b', '2']]],
    ['screenX=1,ScreenY=2,innerWidth=3,innerHeight=4', [['left', '1'], ['top', '2'], ['width', '3'], ['height', '4']]],
    ['width=1,height=2,innerwidth=3,width=4', [['width', '4'], ['height', '2']]],
    ['É=Ä,x\u00a0y=Z\u000bQ', [['É', 'Ä'], ['x\u00a0y', 'z\u000bq']]],
  ] as const)('tokenizes %j in insertion order', (input, expected) => {
    const { browser, setUpFeatures } = createOpeningFixture();
    browser.window.open('', '_blank', input);
    expect([...setUpFeatures.mock.calls[0]![0]]).toEqual(expected);
  });

  it.each([
    ['', true], ['yes', true], ['true', true], ['TRUE', true], ['false', false],
    ['no', false], ['1', true], ['-1', true], ['+01tail', true], [' 2.5', true],
    ['0', false], ['-0', false], ['0x1', false], ['.1', false], ['\u00a01', false],
    ['9999999999999999999999999999999999999999', true],
  ] as const)('parses boolean feature %j', (input, expected) => {
    const { browser, browsingContext } = createOpeningFixture();
    browser.window.open('', '_blank', 'popup=' + input);
    expect(browsingContext.isPopup).toBe(expected);
  });

  it.each([
    ['', false], ['popup', true], ['popup=0', false], ['popup=0,width=10', false],
    ['noopener', false], ['noreferrer', false], ['noopener=0,noreferrer=0', false],
    ['unknown', true], ['width=100', true],
    ['toolbar,menubar,scrollbars,status', false],
    ['location,menubar,scrollbars,status', false],
    ['location,menubar,scrollbars,status,resizable=0', true],
    ['location,scrollbars,status', true], ['location,menubar,status', true],
    ['location,menubar,scrollbars', true], ['menubar,scrollbars,status', true],
  ] as const)('classifies popup features %j', (input, expected) => {
    const { browser, browsingContext } = createOpeningFixture();
    browser.window.open('', '_blank', input);
    expect(browsingContext.isPopup).toBe(expected);
  });

  it('lets noreferrer force noopener, removes both control features, and passes no-referrer to navigation', () => {
    const { browser, choose, setUpFeatures, navigate } = createOpeningFixture();
    expect(browser.window.open('https://target.test/', '_blank', 'noopener=0,noreferrer')).toBeNull();
    expect(choose).toHaveBeenCalledExactlyOnceWith('_blank', true);
    expect([...setUpFeatures.mock.calls[0]![0]]).toEqual([]);
    expect(navigate.mock.calls[0]![2]).toEqual({ exceptionsEnabled: true, referrerPolicy: 'no-referrer' });
  });

  it('forces noopener for cross-site Blob creators using the top-level origin', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://creator.example.test/');
    const { sourceEnv, choose } = createOpeningFixture(browser);
    const url = browser.window.URL.createObjectURL(new browser.window.Blob(['data']));
    expect(sourceEnv.parseURL(url)!.blobURLEntry).not.toBeNull();
    for (const [topLevelURL, expected] of [
      ['https://creator.example.test/', false],
      ['https://sibling.example.test/', false],
      ['https://other.test/', true],
      ['http://creator.example.test/', true],
    ] as const) {
      sourceEnv.topLevelOrigin = obtainURLOrigin(parseURL(topLevelURL).url!);
      browser.window.open(url, '_blank', 'noopener=0');
      expect(choose).toHaveBeenLastCalledWith('_blank', expected);
    }
  });

  it('preserves opaque Blob origin identity', () => {
    const { browser, sourceEnv, choose } = createOpeningFixture();
    const url = browser.window.URL.createObjectURL(new browser.window.Blob());
    browser.window.open(url, '_blank');
    expect(choose).toHaveBeenLastCalledWith('_blank', false);
    sourceEnv.topLevelOrigin = createOpaqueOrigin();
    browser.window.open(url, '_blank');
    expect(choose).toHaveBeenLastCalledWith('_blank', true);
  });
});

describe('window-open coordination', () => {
  it('applies defaults and LegacyNullToEmptyString before the environment operation', () => {
    const { browser, sourceEnv, choose, setUpFeatures } = createOpeningFixture();
    const openWindow = vi.spyOn(sourceEnv, 'openWindow');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the Window receiver.
    Reflect.apply(browser.window.open, browser.window, [undefined, undefined, null]);
    expect(openWindow).toHaveBeenCalledExactlyOnceWith('', '_blank', '');
    expect(choose).toHaveBeenCalledExactlyOnceWith('_blank', false);
    expect([...setUpFeatures.mock.calls[0]![0]]).toEqual([]);
  });

  it('normalizes an empty target and returns before touching a rejected destination', () => {
    const { browser, choose, setUpFeatures, updateURLAndHistory, navigate } = createOpeningFixture();
    choose.mockReturnValue([null, 'existing-or-none']);
    expect(browser.window.open('', '', 'popup')).toBeNull();
    expect(choose).toHaveBeenCalledExactlyOnceWith('_blank', false);
    expect(setUpFeatures).not.toHaveBeenCalled();
    expect(updateURLAndHistory).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['', 'about:blank', 'about:blank?query#fragment'])(
    'updates a new target\'s history for %j without starting navigation', (url) => {
      const { browser, target, setUpFeatures, updateURLAndHistory, navigate } = createOpeningFixture();
      expect(browser.window.open(url, '_blank')).toBe(target.activeWindowProxy.platform);
      expect(serializeURL(updateURLAndHistory.mock.calls[0]![0])).toBe(url || 'about:blank');
      expect(setUpFeatures.mock.invocationCallOrder[0]).toBeLessThan(updateURLAndHistory.mock.invocationCallOrder[0]!);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('navigates a new non-blank target using the entry Document and default referrer policy', () => {
    const { browser, sourceEnv, target, navigate, updateURLAndHistory } = createOpeningFixture();
    expect(browser.window.open('https://target.test/page', 'named')).toBe(target.activeWindowProxy.platform);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      sourceEnv.parseURL('https://target.test/page'), sourceEnv.window.document,
      { exceptionsEnabled: true, referrerPolicy: '' },
    );
    expect(updateURLAndHistory).not.toHaveBeenCalled();
  });

  it('does not apply popup features or navigate an existing target for an empty URL', () => {
    const { browser, sourceEnv, target, choose, browsingContext, setUpFeatures, navigate } = createOpeningFixture();
    choose.mockReturnValue([target, 'existing-or-none']);
    expect(browser.window.open('', 'named', 'popup')).toBe(target.activeWindowProxy.platform);
    expect(setUpFeatures).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(browsingContext.openerBrowsingContext).toBe(sourceEnv.window.browsingContext);
  });

  it('sets the opener on the current browsing context after navigation', () => {
    const { browser, sourceEnv, target, choose, browsingContext, navigate } = createOpeningFixture();
    choose.mockReturnValue([target, 'existing-or-none']);
    const replacement = new BrowsingContext(target.activeWindowProxy);
    replacement.setNavigable(target);
    navigate.mockImplementation(() => { target.activeDocument!.browsingContext = replacement; });
    browser.window.open('https://target.test/', 'named');
    expect(replacement.openerBrowsingContext).toBe(sourceEnv.window.browsingContext);
    expect(browsingContext.openerBrowsingContext).toBeNull();
  });

  it.each(['_sElF', '_PARENT', '_top', 'named'])(
    'preserves an existing opener for noopener and applies the return rule for %s', (name) => {
      const { browser, target, choose, browsingContext } = createOpeningFixture();
      choose.mockReturnValue([target, 'existing-or-none']);
      browsingContext.openerBrowsingContext = browsingContext;
      const result = browser.window.open('', name, 'noopener');
      expect(result).toBe(name === 'named' ? null : target.activeWindowProxy.platform);
      expect(browsingContext.openerBrowsingContext).toBe(browsingContext);
    },
  );

  it('returns null for a new-with-no-opener result even without a noopener feature', () => {
    const { browser, target, choose, updateURLAndHistory } = createOpeningFixture();
    choose.mockReturnValue([target, 'new-with-no-opener']);
    expect(browser.window.open('', '_blank')).toBeNull();
    expect(updateURLAndHistory).toHaveBeenCalledOnce();
  });
});

function createOpeningFixture(browser = new Browlet({ route: () => '' })) {
  const sourceEnv = getRelevantRealm(browser.window).env;
  const target = TopLevelTraversable.create(sourceEnv.userAgent, null, 'target');
  const browsingContext = target.activeBrowsingContext!;
  // Control the unfinished owners; exercise the real Window binding and opening algorithm.
  const choose = vi.spyOn(sourceEnv.window.navigable!, 'chooseNavigable')
    .mockReturnValue([target, 'new-and-unrestricted']);
  const setUpFeatures = vi.spyOn(browsingContext, 'setUpFeatures').mockImplementation(() => {});
  const updateURLAndHistory = vi.spyOn(target.activeDocument!, 'updateURLAndHistory').mockImplementation(() => {});
  const navigate = vi.spyOn(target, 'navigate').mockImplementation(() => {});
  return { browser, sourceEnv, target, browsingContext, choose, setUpFeatures, updateURLAndHistory, navigate };
}
