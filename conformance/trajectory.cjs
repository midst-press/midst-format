const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report. An uncaught throw is
// logged by class only and exits 2.
const {logEvent,installUncaughtHandler}=require('./log.cjs');
installUncaughtHandler();
// Required where used, so a usage error is reported without a built harness.
const convertMidstFile=(raw)=>require('../out/converter.cjs').convertMidstFile(raw);
const {normalise}=require('./normalise.cjs');
const step=(i,c)=>i.slice(0,c.front)+c.inserted+i.slice(i.length-c.end);

function check(zip){
  const name=path.basename(zip,'.midst.zip');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'midst-'));
  try{
    execFileSync('unzip',['-q','-j','-o',zip,`${name}.midst`,'-d',tmp],{stdio:'pipe'});
    const old=fs.readFileSync(path.join(tmp,`${name}.midst`),'utf8');
    const frames=JSON.parse(old).editorTimelineFrames;
    const {text,history}=JSON.parse(convertMidstFile(old));
    // expected intermediate per frame, via the app's own normalisation config
    const expected=frames.map(f=>normalise(f.content));
    let acc='', firstBad=null, bad=0;
    for(let i=0;i<history.length;i++){
      acc=step(acc,history[i]);
      if(acc!==expected[i]){ bad++; if(!firstBad) firstBad={i,exp:expected[i],got:acc}; }
    }
    const endpointOk = acc===text;
    return {name,nFrames:frames.length,nHist:history.length,bad,firstBad,endpointOk,text,history,expected};
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

const z=process.argv[2];
if(!z){console.log('usage: node conformance/trajectory.cjs <poem.midst.zip | dir-of-zips>');logEvent('error','usage');process.exit(2);}
const r=check(z);
console.log(`${r.name}: frames ${r.nFrames}, history ${r.nHist}`);
console.log(`  endpoint check (replay === text) : ${r.endpointOk}`);
console.log(`  TRAJECTORY: frames mismatching   : ${r.bad} of ${r.nHist}`);
if(r.firstBad){
  console.log(`  first mismatch at frame ${r.firstBad.i}`);
  console.log(`    expected: ${JSON.stringify(r.firstBad.exp).slice(0,180)}`);
  console.log(`    got     : ${JSON.stringify(r.firstBad.got).slice(0,180)}`);
}
// CONTROLS: the trajectory check must detect what the endpoint check could not
const muts={
 'append X to a MIDDLE change': h=>{h[Math.floor(h.length/2)].inserted+='X';},
 'DROP a middle change':        h=>{h.splice(Math.floor(h.length/2),1);},
 'swap two adjacent middle':    h=>{const i=Math.floor(h.length/2);[h[i],h[i+1]]=[h[i+1],h[i]];},
 'front += 1 mid-history':      h=>{h[Math.floor(h.length/2)].front+=1;},
};
console.log('  controls (trajectory check vs the corruptions the endpoint check missed):');
for(const [label,f] of Object.entries(muts)){
  const h=JSON.parse(JSON.stringify(r.history)); f(h);
  let acc='',bad=0;
  for(let i=0;i<h.length;i++){ acc=step(acc,h[i]); if(acc!==r.expected[i])bad++; }
  console.log(`    ${label.padEnd(30)} detected:${bad>0}  (${bad} frames diverge)`);
}
