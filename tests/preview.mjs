// Isolated synthetic service. No production credentials, data or alert keys.
import {isolatePreviewEnvironment,refreshPreviewCache} from './preview-fixture.mjs';
isolatePreviewEnvironment();
refreshPreviewCache(process.env.WTI_DATA_DIR);
const refresh=setInterval(()=>refreshPreviewCache(process.env.WTI_DATA_DIR),5000);
refresh.unref();
const realFetch=global.fetch;
global.fetch=async(url,options)=>{
  if(String(url).includes('/api/news'))return Response.json({items:[],maritime:{risk:'UNKNOWN'}});
  if(String(url).startsWith('https://news.google.com'))return new Response('<rss><channel></channel></rss>');
  return realFetch(url,options);
};
await import('../server.mjs');
