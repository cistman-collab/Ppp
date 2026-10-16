// Shared deterministic gates for live signals and historical replay.
export function validPrices(direction, p) {
  if (!p || !['LONG', 'SHORT'].includes(direction)) return false;
  if (![p.entryLow, p.entryHigh, p.stop, p.tp1, p.tp2].every(Number.isFinite)) return false;
  return p.entryLow <= p.entryHigh && (direction === 'LONG'
    ? p.stop < p.entryLow && p.tp1 > p.entryHigh && p.tp2 > p.tp1
    : p.stop > p.entryHigh && p.tp1 < p.entryLow && p.tp2 < p.tp1);
}

export function entryTrigger(direction, bars) {
  const last = bars.at(-1), previous = bars.at(-2);
  if (!last || !previous || last.t - previous.t !== 300000) return false;
  const midpoint = (previous.o + previous.c) / 2;
  return direction === 'LONG'
    ? previous.c < previous.o && last.c > last.o && last.l <= previous.l && last.c > midpoint
    : direction === 'SHORT'
      ? previous.c > previous.o && last.c < last.o && last.h >= previous.h && last.c < midpoint
      : false;
}

export function signalStage(direction, triggered, prices) {
  return validPrices(direction, prices) ? (triggered ? 'ENTER' : 'PREPARE') : 'WAIT';
}

// Never derive an internal fetch destination from user-controlled Host headers.
export function internalOrigin() {
  return `http://127.0.0.1:${Number(process.env.PORT || 10000)}`;
}

export function validAIReview(answer, setup) {
  if(typeof answer!=='string') return false;
  if((answer.match(/^AI REVIEW:/gim)||[]).length!==1) return false;
  const verdict=answer.match(/^AI REVIEW:\s*(VALIDATE|REJECT|WAIT)\s*$/im)?.[1]?.toUpperCase();
  if(!verdict) return false;
  if(!validPrices(setup?.direction,setup)) return false;
  const directionFields=answer.match(/^DIRECTION:.*$/gim)||[];
  if(directionFields.length!==1) return false;
  if(verdict!=='VALIDATE' && !new RegExp('^DIRECTION:\\s*('+setup.direction+'|WAIT)\\s*$','im').test(answer)) return false;
  if(verdict==='VALIDATE' && !new RegExp('^DIRECTION:\\s*'+setup.direction+'\\s*$','im').test(answer))return false;
  const fields={ENTRY:[setup.entryLow,setup.entryHigh],STOP:[setup.stop],TP1:[setup.tp1],TP2:[setup.tp2]};
  return Object.entries(fields).every(([field,values])=>{
    if((answer.match(new RegExp('^'+field+':','gim'))||[]).length>1) return false;
    const text=answer.match(new RegExp('^'+field+':([^\\n]*)','im'))?.[1];
    if(verdict!=='VALIDATE' && (!text || /^\s*N\/A\s*$/i.test(text)))return true;
    const numbers=text?.match(/\d+(?:\.\d+)?/g)?.map(Number)||[];
    return !/^\s*-/.test(text||'') && numbers.length===values.length && numbers.every((number,i)=>number===Number(values[i].toFixed(2)));
  });
}
