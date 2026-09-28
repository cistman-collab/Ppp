// Indicative weekly schedule only; exchange holidays and halts NOT verified.
module.exports=(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const d=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',
  {timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(d).map(p=>[p.type,p.value]));
 const day=parts.weekday,m=Number(parts.hour)*60+Number(parts.minute);
 const open=(day==='Sun'&&m>=1080)||(['Mon','Tue','Wed','Thu'].includes(day)&&(m<1020||m>=1080))||(day==='Fri'&&m<1020);
 res.status(200).json({scheduledOpen:open,status:open?'SCHEDULED OPEN':'SCHEDULED CLOSED',
  newYorkTime:day+' '+parts.hour+':'+parts.minute,checkedAt:d.toISOString(),
  disclaimer:'Regular weekly schedule only; holidays, early closes and halts not verified.'});
};
