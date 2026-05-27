import { runScenarios } from '../../dispatch';

runScenarios('pseudo-resource', 'normal', [
  {
    name: 'resource state muted matches audio and video muted property',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <audio id="audio"></audio>
      <video id="video"></video>
      <audio id="plain"></audio>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        (document.getElementById('audio') as HTMLAudioElement).muted = true;
        (document.getElementById('video') as HTMLVideoElement).muted = true;
      });
    },
    cases: [
      { select: '#audio:muted', expect: { ids: ['audio'] } },
      { select: '#video:muted', expect: { ids: ['video'] } },
      { select: '#plain:muted', expect: { ids: [] } },
    ],
  },

  {
    name: 'resource state paused and seeking exclude non-media elements',
    // status: 'only',
    engines: ['selectlet'],
    markup: `<div id="x"></div><audio id="audio"></audio>`,
    cases: [
      { select: '#x:paused', expect: { ids: [] } },
      { select: '#x:seeking', expect: { ids: [] } },
      { select: '#x:playing', expect: { ids: [] } },
      { select: '#audio:paused', expect: { ids: ['audio'] } },
    ],
  },

  {
    name: 'resource state native support probe',
    // status: 'only',
    engines: ['native'],
    markup: `<audio id="audio"></audio><video id="video"></video>`,
    cases: [
      { select: '#audio:paused', expect: { throws: true }, browsers: ['chromium', 'firefox'] },
      { select: '#audio:paused', expect: { throws: false, ids: ['audio'] }, browsers: ['webkit'] },
      { select: '#audio:playing', expect: { throws: true }, browsers: ['chromium', 'firefox']  },
      { select: '#audio:playing', expect: { throws: false, ids: [] }, browsers: ['webkit']  },
      { select: '#audio:muted', expect: { throws: true }, browsers: ['chromium', 'firefox']  },
      { select: '#audio:muted', expect: { throws: false, ids: [] }, browsers: ['webkit']  },
    ],
  },

]);
