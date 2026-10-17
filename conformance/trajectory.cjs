const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report. An uncaught throw is
// logged by class only and exits 2.
const {logEvent,installUncaughtHandler}=require('./log.cjs');
const {ConformanceError}=require('./verify_lib.cjs');
// Required where used, so a usage error is reported without a built harness.
const convertMidstFile=(raw)=>require('../out/converter.cjs').convertMidstFile(raw);
const {normalise}=require('./normalise.cjs');
const step=(i,c)=>i.slice(0,c.front)+c.inserted+i.slice(i.length-c.end);

// NO POEM DATA ON STDOUT (midst-format #7, #41). The report names no archive or entry and quotes no frame. A
// mismatch is reported by its frame number; the frames' text is printed only with --show-text, which is for
// looking at one archive on your own machine, never for output that goes anywhere else.
function check(zip){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'midst-'));
  try{
    // Extract everything and pick the .midst off disk: an entry name passed to unzip is a pattern ([draft]) and an
    // NFD name does not survive the round trip (midst-format #6).
    execFileSync('unzip',['-q','-j','-o',zip,'-x','__MACOSX/*','-d',tmp],{stdio:'pipe'});
    const cands=fs.readdirSync(tmp).filter(n=>n.endsWith('.midst')&&!n.startsWith('._'));
    if(cands.length!==1) throw new ConformanceError('ENTRY_COUNT',cands.length);
    const old=fs.readFileSync(path.join(tmp,cands[0]),'utf8');
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
    return {nFrames:frames.length,nHist:history.length,bad,firstBad,endpointOk,text,history,expected};
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

// The report's lines. Frame text appears only when showText is set.
function report(r,{showText=false}={}){
  const lines=[
    `frames ${r.nFrames}, history ${r.nHist}`,
    `  endpoint check (replay === text) : ${r.endpointOk}`,
    `  TRAJECTORY: frames mismatching   : ${r.bad} of ${r.nHist}`,
  ];
  if(r.firstBad){
    lines.push(`  first mismatch at frame ${r.firstBad.i}`);
    if(showText){
      lines.push(`    expected: ${JSON.stringify(r.firstBad.exp).slice(0,180)}`);
      lines.push(`    got     : ${JSON.stringify(r.firstBad.got).slice(0,180)}`);
    } else lines.push('    (frame text not shown; --show-text prints it, for local inspection only)');
  }
  return lines;
}

// CONTROLS: the trajectory check must detect what the endpoint check could not
const muts={
 'append X to a MIDDLE change': h=>{h[Math.floor(h.length/2)].inserted+='X';},
 'DROP a middle change':        h=>{h.splice(Math.floor(h.length/2),1);},
 'swap two adjacent middle':    h=>{const i=Math.floor(h.length/2);[h[i],h[i+1]]=[h[i+1],h[i]];},
 'front += 1 mid-history':      h=>{h[Math.floor(h.length/2)].front+=1;},
};
function controls(r){
  const lines=['  controls (trajectory check vs the corruptions the endpoint check missed):'];
  for(const [label,f] of Object.entries(muts)){
    const h=JSON.parse(JSON.stringify(r.history)); f(h);
    let acc='',bad=0;
    for(let i=0;i<h.length;i++){ acc=step(acc,h[i]); if(acc!==r.expected[i])bad++; }
    lines.push(`    ${label.padEnd(30)} detected:${bad>0}  (${bad} frames diverge)`);
  }
  return lines;
}

function main(argv){
  const showText=argv.includes('--show-text');
  const z=argv.find(a=>a!=='--show-text');
  if(!z){console.log('usage: node conformance/trajectory.cjs [--show-text] <poem.midst.zip>');logEvent('error','usage');process.exit(2);}
  const r=check(z);
  for(const l of [...report(r,{showText}),...controls(r)]) console.log(l);
}

module.exports={report};
if(require.main===module){ installUncaughtHandler(); main(process.argv.slice(2)); }
