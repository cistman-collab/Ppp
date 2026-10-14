const CACHE='wti-v5-shell-2';

self.addEventListener('install',event=>{
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE).then(cache=>
      cache.addAll([
        '/',
        '/simple.html',
        '/manifest.webmanifest',
        '/icon.svg'
      ])
    )
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys=>
        Promise.all(
          keys
            .filter(key=>key.startsWith('wti-') && key!==CACHE)
            .map(key=>caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin || event.request.url.includes('/api/'))return;

  event.respondWith(
    fetch(event.request)
      .catch(()=>caches.match(event.request))
  );
});

self.addEventListener('push',event=>{
  let data={};

  try{
    data=event.data
      ?event.data.json()
      :{};
  }catch(e){
    data={
      body:event.data
        ?event.data.text()
        :'WTI Pro market update'
    };
  }

  const title=
    data.title||
    'WTI Pro Alert';

  const options={
    body:
      data.body||
      'Market conditions changed. Open WTI Pro to review.',
    icon:'/icon-192.png',
    badge:'/icon-192.png',
    tag:data.tag,
    timestamp:Date.now(),
    data:{
      url:
        data.url||
        '/simple.html'
    }
  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options
    )
  );
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();

  const target=new URL(event.notification.data?.url||'/simple.html',self.location.origin);
  const url=target.origin===self.location.origin?target.href:self.location.origin+'/simple.html';

  event.waitUntil(
    clients.matchAll({
      type:'window',
      includeUncontrolled:true
    }).then(list=>{
      for(const client of list){
        if('focus' in client){
          client.navigate(url);
          return client.focus();
        }
      }

      return clients.openWindow(url);
    })
  );
});
