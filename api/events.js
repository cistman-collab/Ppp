const M=60000;

function zonedUtc(date,hour,minute,timeZone){
  const [year,month,day]=date
    .split('-')
    .map(Number);

  const guess=Date.UTC(
    year,month-1,day,hour,minute,0
  );

  const parts=Object.fromEntries(
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone,
        year:'numeric',
        month:'2-digit',
        day:'2-digit',
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        hourCycle:'h23'
      }
    )
    .formatToParts(new Date(guess))
    .map(p=>[p.type,p.value])
  );

  const shown=Date.UTC(
    Number(parts.year),
    Number(parts.month)-1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return guess-(shown-guess);
}

const ET='America/New_York';
const VIENNA='Europe/Vienna';
const EVENTS=[];

function addEvent(
  name,type,at,
  beforeMinutes,afterMinutes,source
){
  EVENTS.push({
    name,type,at,
    beforeMinutes,
    afterMinutes,
    source
  });
}

[
  ['2026-10-14','US CPI','CPI'],
  ['2026-11-06','US Employment Situation (NFP)','NFP'],
  ['2026-11-10','US CPI','CPI'],
  ['2026-12-04','US Employment Situation (NFP)','NFP'],
  ['2026-12-10','US CPI','CPI']
].forEach(([date,name,type])=>
  addEvent(
    name,type,
    zonedUtc(date,8,30,ET),
    45,60,
    'US Bureau of Labor Statistics'
  )
);

[
  '2026-10-07','2026-10-21','2026-10-28',
  '2026-11-04','2026-11-18','2026-11-25',
  '2026-12-02','2026-12-09','2026-12-16',
  '2026-12-23','2026-12-30'
].forEach(date=>
  addEvent(
    'EIA Weekly Petroleum Status Report',
    'EIA',
    zonedUtc(date,10,30,ET),
    45,60,
    'US Energy Information Administration'
  )
);

[
  ['2026-10-15',12,0],
  ['2026-11-12',12,0]
].forEach(([date,hour,minute])=>
  addEvent(
    'EIA Weekly Petroleum Status Report',
    'EIA',
    zonedUtc(date,hour,minute,ET),
    45,60,
    'US Energy Information Administration'
  )
);

[
  '2026-10-28',
  '2026-12-09'
].forEach(date=>
  addEvent(
    'FOMC policy decision',
    'FOMC',
    zonedUtc(date,14,0,ET),
    60,90,
    'Federal Reserve'
  )
);
addEvent(
  'FOMC Minutes',
  'FOMC_MINUTES',
  zonedUtc('2026-11-18',14,0,ET),
  45,60,
  'Federal Reserve'
);

[
  ['2026-10-04','OPEC+ production meeting'],
  ['2026-11-29','42nd OPEC and non-OPEC Ministerial Meeting']
].forEach(([date,name])=>
  addEvent(
    name,
    'OPEC',
    zonedUtc(date,12,0,VIENNA),
    720,720,
    'OPEC official announcement'
  )
);

EVENTS.sort((a,b)=>a.at-b.at);

export function getEventRisk(now=Date.now()){
  const detailed=EVENTS.map(e=>{
    const blockFrom=
      e.at-e.beforeMinutes*M;

    const blockUntil=
      e.at+e.afterMinutes*M;

    return{
      name:e.name,
      type:e.type,
      startsAt:new Date(e.at).toISOString(),
      blockFrom:new Date(blockFrom).toISOString(),
      blockUntil:new Date(blockUntil).toISOString(),
      minutesAway:Math.round((e.at-now)/M),
      source:e.source,
      active:
        now>=blockFrom &&
        now<=blockUntil
    };
  });

  const activeEvent=
    detailed.find(x=>x.active)||null;

  const nextEvent=
    detailed.find(
      x=>Date.parse(x.startsAt)>now
    )||null;

  return{
    blocked:Boolean(activeEvent),

    status:activeEvent
      ?'HIGH IMPACT EVENT'
      :'CLEAR',

    activeEvent,

    nextEvent,

    upcoming:detailed
      .filter(
        x=>Date.parse(x.blockUntil)>=now
      )
      .slice(0,8),

    scheduleUpdatedAt:'2026-10-04',

    note:
      'Official published dates. OPEC events without a published decision time use a wide all-day safety window.'
  };
}

export default function handler(req,res){
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate'
  );

  const testAt=
    typeof req.query?.at==='string'
      ?Date.parse(req.query.at)
      :NaN;

  const now=
    Number.isFinite(testAt)
      ?testAt
      :Date.now();

  return res.status(200).json({
    ok:true,
    checkedAt:new Date(now).toISOString(),
    ...getEventRisk(now)
  });
}
