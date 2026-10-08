const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const {convertMidstFile}=require('../out/converter.cjs');
const {normalise}=require('./normalise.cjs');
const step=(i,c)=>i.slice(0,c.front)+c.inserted+i.slice(i.length-c.end);
const zip=process.argv[2];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'one-'));
// Extract EVERYTHING, then pick the .midst off DISK. An NFD filename cannot be passed back
// through argv reliably -- that is what broke mónica-de-la-torre--december.
execFileSync('unzip',['-q','-j','-o',zip,'-d',tmp],{stdio:'pipe'});
const cands=fs.readdirSync(tmp).filter(n=>n.endsWith('.midst')&&!n.startsWith('._'));
console.log('entries on disk after extract:',fs.readdirSync(tmp));
if(cands.length!==1) throw new Error('candidates='+cands.length);
const old=fs.readFileSync(path.join(tmp,cands[0]),'utf8');
const frames=JSON.parse(old).editorTimelineFrames;
const {text,history}=JSON.parse(convertMidstFile(old));
let acc='',bad=0;
for(let i=0;i<history.length;i++){acc=step(acc,history[i]); if(acc!==normalise(frames[i].content))bad++;}
const h=JSON.parse(JSON.stringify(history)); h[Math.floor(h.length/2)].inserted+='\u0001';
let a2='',b2=0; for(let i=0;i<h.length;i++){a2=step(a2,h[i]); if(a2!==normalise(frames[i].content))b2++;}
const out=(process.env.MIDST_OUT||require('os').tmpdir())+'/'+path.basename(zip,'.midst.zip')+'.converted.midst';
fs.writeFileSync(out,JSON.stringify({text,history}));
console.log(`frames ${frames.length}  badFrames ${bad}  endpoint ${acc===text}  control_fired ${b2>0}`);
fs.rmSync(tmp,{recursive:true,force:true});
