/** Deterministic, privacy-preserving topic classifier.
 * Only uses text that was actually provided by the share source or extracted
 * from public metadata. It does not infer what's inside inaccessible media.
 */
((root) => {
  'use strict';
  const TOPICS = {
    'DIY': ['diy','drywall','plastering','plasterboard','home repair','wall repair','home improvement','woodworking','woodwork','carpentry','shelving','floating shelves','install a shelf','drill bits','power tools','sanding','renovation','plumbing','faucet','fix a leak','grouting','tile installation'],
    'Food & Recipes': ['recipe','recipes','cooking','baking','bake','pasta','pizza dough','sourdough','meal prep','ingredients','dinner recipe','cuisine','air fryer','kitchen recipe','chocolate cake'],
    'Travel': ['travel','vacation','road trip','roadtrip','flight booking','hotel review','itinerary','tourism','sightseeing','city break','travel guide','places to visit','weekend getaway','trip to'],
    'Technology': ['software','programming','javascript','python coding','developer','artificial intelligence','machine learning','computer hardware','cybersecurity','tech review','smartphone','laptop','android tutorial','web development','computer science'],
    'Reading': ['novel','literature','book review','reading list','books to read','poetry','author interview','fiction book','historical fiction','goodreads'],
    'Gaming': ['gaming','video game','video games','gameplay','walkthrough','playstation','ps5','xbox','nintendo','steam deck','god of war','gow valhalla','valhalla dlc','minecraft','fortnite','zelda','elden ring','roblox','rpg game','game secrets','game guide','boss fight','gaming tips'],
    'Health & Fitness': ['workout','strength training','weight lifting','fitness','exercise routine','cardio','gym routine','running plan','yoga','physical therapy','sleep hygiene','nutrition advice'],
    'Sports': ['football match','soccer match','basketball','nba','nfl','nhl','tennis','formula 1','f1 race','champions league','world cup','sports highlights','hockey match'],
    'Music': ['music','guitar tutorial','piano tutorial','singing lessons','song cover','album review','concert','violin','drum lesson','music production','live performance'],
    'Movies & TV': ['movie review','film review','cinema','movie trailer','tv series','television series','netflix show','actor interview','film analysis','documentary film'],
    'Finance': ['personal finance','investing','stock market','financial statements','mortgage rates','credit score','retirement savings','tax planning','budgeting','financial planning','interest rates'],
    'Gardening': ['gardening','garden beds','planting seeds','growing tomatoes','soil compost','composting','greenhouse','houseplants','vegetable garden','pruning','plant care'],
    'Pets & Animals': ['cat care','dog training','pet health','veterinary','aquarium','animal rescue','wildlife documentary','bird watching','pet food'],
    'Vehicles': ['car maintenance','motorcycle maintenance','tire change','engine oil','car repair','brake pads','vehicle review','electric car','car tires','motorcycle gear'],
    'Science': ['astronomy','physics','chemistry','biology','scientific research','space exploration','nasa mission','quantum mechanics','neuroscience','climate science'],
    'Art & Design': ['graphic design','typography','illustration','painting tutorial','watercolor','digital art','interior design','architecture design','design inspiration','photography tutorial']
  };
  const PLACEHOLDERS = /^(instagram (reel|post)|x post|youtube (short|video)|facebook post|reddit post|tiktok video|website|saved link|link)$/i;
  const STOP = /^(shared link \(content not analyzed\)|saved link \(content not analyzed\)|details unavailable from source|description not provided by source)/i;
  function normal(text) { return String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' '); }
  function matches(text, term) {
    if (!text || !term) return false;
    return (` ${text} `).includes(` ${normal(term)} `);
  }
  function sourcePath(url) {
    try {
      const u = new URL(url);
      // Social IDs/slug hashes rarely convey useful topical information.
      const host = u.hostname.toLowerCase();
      if (/(?:^|\.)(?:instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|tiktok\.com)$/.test(host)) return '';
      const path = decodeURIComponent(u.pathname).slice(0,200);
      return /[a-z]{3,}/i.test(path) ? path : '';
    } catch {return '';}
  }
  function classify({ title, description, url, existingCategories=[] } = {}) {
    const rawTitle = String(title || '').trim();
    const rawDesc = String(description || '').trim();
    const t = PLACEHOLDERS.test(rawTitle) ? '' : normal(rawTitle);
    const d = STOP.test(rawDesc) ? '' : normal(rawDesc);
    const p = normal(sourcePath(url));
    if (!t && !d && !p) return {category:'Unsorted', confidence:'none', reason:'No readable subject information'};
    const scores = Object.entries(TOPICS).map(([category,terms])=>{
      let score = 0;
      let count = 0;
      for(const term of terms) {
        const inTitle=matches(t,term), inDesc=matches(d,term), inPath=matches(p,term);
        if (inTitle || inDesc || inPath) {
          count++;
          score += inTitle ? 6 : 0;
          score += inDesc ? 3 : 0;
          score += inPath ? 1 : 0;
        }
      }
      return {category,score,count};
    }).sort((a,b)=>b.score-a.score);
    const best=scores[0], second=scores[1];
    if (!best || best.score<3 || best.score - (second?.score||0)<2) return {category:'Unsorted',confidence:'low',reason:'No clear topic match'};
    // A newly created category must be more reliable than an existing category.
    if (!existingCategories.includes(best.category) && best.score<6) return {category:'Unsorted',confidence:'low',reason:'Insufficient evidence for new category'};
    return {category:best.category,confidence:best.score>=8?'high':'medium',reason:'Matched subject terms',score:best.score};
  }
  root.RepositoryClassifier = Object.freeze({classify, topics:Object.freeze(Object.keys(TOPICS))});
})(typeof globalThis==='undefined'?self:globalThis);
