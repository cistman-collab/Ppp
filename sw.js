const CACHE='wti-v4-shell-2';

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>
      c.addAll([
        '/',
        '/manifest.webmanifest',
        '/icon.svg'
      ])
    )
  );

  self.skipWaiting();
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(ks=>
      Promise.all(
        ks
          .filter(k=>k!==CACHE)
          .map(k=>caches.delete(k))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener('fetch',e=>{
  if(e.request.url.includes('/api/'))return;

  e.respondWith(
    fetch(e.request)
      .catch(()=>caches.match(e.request))
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
      title:'WTI Pro Alert',
      body:event.data
        ?event.data.text()
        :'WTI market conditions changed.'
    };
  }

  const title=
    data.title||
    'WTI Pro Alert';

  const options={
    body:
      data.body||
      'WTI market conditions changed.',
    icon:'/icon.svg',
    badge:'/icon.svg',
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

  const target=
    event.notification.data?.url||
    '/simple.html';

  event.waitUntil(
    clients.matchAll({
      type:'window',
      includeUncontrolled:true
    }).then(list=>{
      for(const client of list){
        if('focus' in client){
          client.navigate(target);
          return client.focus();
        }
      }

      if(clients.openWindow){
        return clients.openWindow(target);
      }
    })
  );
});
