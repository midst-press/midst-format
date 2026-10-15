const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report. An uncaught throw is
// logged by class only and exits 2.
const {logEvent,installUncaughtHandler}=require('./log.cjs');
installUncaughtHandler();
const step=(i,c)=>i.slice(0,c.front)+c.inserted+i.slice(i.length-c.end);
const replay=h=>h.reduce((a,c)=>step(a,c),'');
const z=process.argv[2];
if(!z){console.log('usage: node conformance/control_probe.cjs <poem.midst.zip>');logEvent('error','usage');process.exit(2);}
// Required after the usage check, so it is reported without a built harness.
const {convertMidstFile}=require('../out/converter.cjs');
const name=require('path').basename(z,'.midst.zip');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'midst-'));
execFileSync('unzip',['-q','-j','-o',z,`${name}.midst`,'-d',tmp]);
const {text,history}=JSON.parse(convertMidstFile(fs.readFileSync(path.join(tmp,`${name}.midst`),'utf8')));
fs.rmSync(tmp,{recursive:true,force:true});
const base=replay(history);
console.log(`baseline replay === text : ${base===text}   (text ${text.length} chars, ${history.length} changes)`);
const mut={
 'append X to inserted, MIDDLE':      h=>{h[Math.floor(h.length/2)].inserted+='X';},
 'append X to inserted, LAST':        h=>{h[h.length-1].inserted+='X';},
 'append X to inserted, FIRST':       h=>{h[0].inserted+='X';},
 'front += 1, MIDDLE':                h=>{h[Math.floor(h.length/2)].front+=1;},
 'end += 1, MIDDLE':                  h=>{h[Math.floor(h.length/2)].end+=1;},
 'DROP the middle change':            h=>{h.splice(Math.floor(h.length/2),1);},
 'DROP the last change':              h=>{h.pop();},
 'swap two adjacent middle changes':  h=>{const i=Math.floor(h.length/2);[h[i],h[i+1]]=[h[i+1],h[i]];},
 'truncate history to 90%':           h=>{h.length=Math.floor(h.length*0.9);},
};
for(const [label,f] of Object.entries(mut)){
  const h=JSON.parse(JSON.stringify(history)); f(h);
  let out; try{ out=replay(h); }catch(e){ out='<<threw>>'; }
  console.log(`  ${label.padEnd(34)} detected:${String(out!==text).padEnd(6)} len ${String(out.length).padStart(5)} vs ${text.length}`);
}
