// Does normalisation DISCARD markup? The trajectory test cannot see this: it normalises both
// sides, so anything normalise() drops is absent from expectation and reality alike.
const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const {normalise}=require('./normalise.cjs');
// Paths come from the environment. Poem data never lives in this repository.
const CORPUS = process.env.MIDST_CORPUS;
const OUTDIR = process.env.MIDST_OUT || require('path').join(require('os').tmpdir(), 'midst-converted');
if (!CORPUS) { console.error('MIDST_CORPUS is not set. Point it at a directory of .midst.zip files.'); process.exit(2); }
const ARCHIVE=CORPUS;
const tags=s=>{const m=new Map();for(const x of s.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9]*)/g)){const t=x[1].toLowerCase();m.set(t,(m.get(t)||0)+1);}return m;};
const zips=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
  if(e.isDirectory())w(p);else if(e.name.endsWith('.midst.zip'))zips.push(p);}})(ARCHIVE);
zips.sort();
const lostTotal=new Map(); let checked=0, poemsWithLoss=0;
// CONTROL: a tag we know StarterKit is configured to drop must be reported as lost
const ctl=normalise('<p>a <s>struck</s> b</p>');
console.log(`control  <s> through normalise -> ${JSON.stringify(ctl)}`);
console.log(`control  's' reported lost     -> ${tags('<p>a <s>x</s> b</p>').has('s') && !tags(ctl).has('s')}\n`);
for(const zip of zips){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ml-'));
  try{
    execFileSync('unzip',['-q','-j','-o',zip,'-d',tmp],{stdio:'pipe'});
    const cands=fs.readdirSync(tmp).filter(n=>n.endsWith('.midst')&&!n.startsWith('._'));
    if(cands.length!==1) throw new Error('candidates='+cands.length);
    const frames=JSON.parse(fs.readFileSync(path.join(tmp,cands[0]),'utf8')).editorTimelineFrames;
    // union of tags across ALL frames, raw vs normalised -- a mark can appear and be deleted mid-poem
    const rawAll=new Map(), normAll=new Map();
    for(const f of frames){
      for(const [t,c] of tags(f.content)) rawAll.set(t,(rawAll.get(t)||0)+c);
      for(const [t,c] of tags(normalise(f.content))) normAll.set(t,(normAll.get(t)||0)+c);
    }
    const RENAME={b:'strong',i:'em',em:'em',strong:'strong'};  // TipTap renames these, it does not drop them
    const lost=[...rawAll.keys()].filter(t=>!normAll.has(t)&&!normAll.has(RENAME[t]||t));
    checked++;
    if(lost.length){ poemsWithLoss++;
      console.log(`LOSS ${path.basename(zip,'.midst.zip').slice(0,52).padEnd(52)} dropped tags: ${lost.map(t=>`${t}(x${rawAll.get(t)})`).join(' ')}`);
      for(const t of lost) lostTotal.set(t,(lostTotal.get(t)||0)+rawAll.get(t));
    }
  }catch(e){ console.log(`ERR  ${path.basename(zip,'.midst.zip')}  ${String(e.message).slice(0,90)}`); }
  finally{ fs.rmSync(tmp,{recursive:true,force:true}); }
}
console.log(`\nchecked ${checked} poems; ${poemsWithLoss} lose at least one tag through normalisation`);
console.log('tags dropped overall:', lostTotal.size? [...lostTotal].map(([t,c])=>`${t}(x${c})`).join(' ') : 'NONE');
