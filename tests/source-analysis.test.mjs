import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const metadataUrl = moduleUrl(read('functions/api/metadata.js'));
const source = await import(moduleUrl(read('functions/api/source-analysis.js').replace('./metadata.js', metadataUrl)));
const brief = await import(moduleUrl(read('functions/api/project-brief.js')));
const model = vm.runInNewContext(read('site/projects.js') + '\nRepositoryProjects', {URL});
const origin = 'https://repository.pages.dev';
const post = (path, body, headers = {}) => new Request(origin + path, {
  method:'POST', headers:{'Content-Type':'application/json', ...headers}, body:JSON.stringify(body)
});
const quote = 'The drain bolt is below the water pump housing.';
const paragraph = quote + ' The service manual includes separate instructions for each model year and cooling system revision.';
const html = '<title>Coolant guide</title><article><nav>Other links</nav><p>' + paragraph + '</p></article>';
const response = (body, type = 'text/html', status = 200) => new Response(body, {
  status, headers:{'Content-Type':type}
});

test('article extraction excludes navigation, paywalls, AI opt-outs and video pages', () => {
  assert.equal(source.articleEvidence(html).excerpt, paragraph);
  assert.equal(source.articleEvidence('<title>Guide</title><p>' + paragraph + '</p>').kind, 'page_metadata');
  for (const markup of [
    '<meta content="noai" name="robots">',
    '<meta name="repositorylinkpreview" content="nosnippet">',
    '<script type="application/ld+json">{"isAccessibleForFree":false}</script>',
    '<meta property="og:type" content="video.other">'
  ]) assert.equal(source.articleEvidence(markup + html).kind, 'saved');
  assert.equal(source.articleEvidence(html.replace('<article>', '<article hidden>')).kind, 'page_metadata');
});

test('robots rules handle specific agents, wildcards, anchoring and longest matches', () => {
  const rules = 'User-agent: *\nDisallow: /\nUser-agent: RepositoryLinkPreview\nDisallow: /maintenance/*/private$\nAllow: /maintenance/public/private$';
  assert.equal(source.robotsAllows(rules, '/maintenance/old/private'), false);
  assert.equal(source.robotsAllows(rules, '/maintenance/public/private'), true);
  assert.equal(source.robotsAllows(rules, '/maintenance/old/private-guide'), true);
  assert.equal(source.robotsAllows('User-agent: *\nDisallow: /\n', '/guide'), false);
});

test('source endpoint checks robots before article and on every redirect', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    if(url === 'https://manuals.example.org/robots.txt') return response('', 'text/plain', 404);
    if(url === 'https://manuals.example.org/guide') return response(html);
    if(url === 'https://manuals.example.org/other') return new Response('', {
      status:302, headers:{location:'https://locked.example.org/guide'}
    });
    if(url === 'https://locked.example.org/robots.txt') return response('User-agent: *\nDisallow: /', 'text/plain');
    throw new Error('Unexpected fetch');
  });
  async function analyze(url, headers) {
    return source.onRequestPost({request:post('/api/source-analysis', {url}, headers)});
  }
  assert.equal((await (await analyze('https://manuals.example.org/guide')).json()).kind, 'article');
  assert.equal((await (await analyze('https://manuals.example.org/other')).json()).kind, 'saved');
  assert.equal((await (await analyze('https://manuals.example.org/guide?token=private')).json()).kind, 'saved');
  assert.equal((await (await analyze('https://www.instagram.com/reel/abc/')).json()).kind, 'saved');
  assert.equal((await analyze('https://127.0.0.1/private')).status, 400);
  assert.equal((await analyze('https://manuals.example.org/guide', {Origin:'https://other.example.org'})).status, 403);
  assert.deepEqual(calls, [
    'https://manuals.example.org/robots.txt', 'https://manuals.example.org/guide',
    'https://manuals.example.org/robots.txt', 'https://manuals.example.org/other',
    'https://locked.example.org/robots.txt'
  ]);
});

test('YouTube Shorts fall back to public title metadata without fetching watch HTML', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    calls.push(url.pathname);
    assert.equal(url.host, 'www.youtube.com');
    assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch?v=abcdefghijk');
    return response(JSON.stringify({provider_name:'YouTube', title:'NMAX coolant change'}), 'application/json');
  });
  const request = post('/api/source-analysis', {url:'https://www.youtube.com/shorts/abcdefghijk?si=tracking'});
  const result = await (await source.onRequestPost({request})).json();
  assert.deepEqual(result, {kind:'youtube_title', title:'NMAX coolant change', description:'', excerpt:''});
  assert.deepEqual(calls, ['/oembed']);
});

test('coolant video-only evidence cannot generate cited tools or steps', async () => {
  const question = {question:'Which coolant specification and capacity apply to this NMAX?', research:'Find the Yamaha NMAX service manual for the exact model year and check the cooling system specifications.'};
  const request = post('/api/project-brief', {mode:'source-brief', title:'NMAX coolant change', links:[
    {kind:'youtube_metadata', title:'Video 1', description:'Coolant replacement video', url:'https://youtube.com/watch?v=abcdefghijk'},
    {kind:'youtube_metadata', title:'Video 2'},
    {kind:'youtube_title', title:'Coolant Short', excerpt:paragraph}
  ]});
  const result = await brief.onRequestPost({request, env:{AI:{run:async (model, input) => {
    const prompt = input.messages[1].content;
    assert.match(prompt, /no footage, audio or transcript/);
    assert.doesNotMatch(prompt, /youtube\.com\/watch/);
    return {response:JSON.stringify({
      steps:[{text:'Drain the coolant', source:3, quote}], tools:[{text:'Use a wrench', source:1, quote}],
      questions:[question]
    })};
  }}}});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.steps, []);
  assert.deepEqual(data.tools, []);
  assert.deepEqual(data.research, [question]);
  assert.deepEqual(data.sources.map(s => s.kind), ['youtube_metadata', 'youtube_metadata', 'youtube_title']);
  assert.match(data.summary, /no readable article excerpts/);
});

test('article citations must use an existing source number and verbatim evidence', () => {
  const input = brief.__test.prepare({mode:'source-brief', title:'Coolant change', links:[
    {kind:'saved'}, {kind:'article', excerpt:paragraph}
  ]});
  const results = brief.__test.parseResponse(JSON.stringify({findings:[
    {source:2, text:'The guide locates the drain bolt below the water pump.', quote},
    {source:2, text:'Replace it every two years.', quote:'Replace the coolant every two years.'},
    {source:99, text:'Unlisted source.', quote},
    {source:1, text:'Saved context only.', quote}
  ]}), input.mode, input.links);
  assert.deepEqual(results.findings, [{source:2, text:'The guide locates the drain bolt below the water pump.', quote}]);
  assert.deepEqual(results.sources, [{source:1, kind:'saved'}, {source:2, kind:'article'}]);
});

test('source identifiers survive backup sanitization and old briefs remain readable', () => {
  const legacy = model.safeBrief({summary:'Earlier brief', steps:['Check the guide'], sourceCount:1});
  assert.equal(legacy.steps[0], 'Check the guide');
  const restored = model.sanitize([{
    id:'p', title:'Coolant', linkIds:['article-link'], brief:{summary:'New brief',
      sources:[{source:1, kind:'article', itemId:'article-link'}],
      findings:[{source:1, text:'Locate the drain bolt.', quote}],
      research:[{question:'Which year?', research:'Find the owner manual.'}]
    }
  }], [{id:'article-link'}])[0].brief;
  assert.equal(restored.sources[0].itemId, 'article-link');
  assert.equal(restored.findings[0].quote, quote);
  assert.equal(restored.research[0].question, 'Which year?');
  assert.equal(model.sourceAnalysisUrl('https://example.org/article?token=private'), '');
  assert.equal(model.sourceAnalysisUrl('https://example.org/article#private'), 'https://example.org/article');
  assert.equal(model.sourceAnalysisUrl('https://youtu.be/abcdefghijk?si=private'), 'https://www.youtube.com/watch?v=abcdefghijk');
});
