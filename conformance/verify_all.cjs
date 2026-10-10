const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const {convertMidstFile}=require('../out/converter.cjs');
const {normalise}=require('./normalise.cjs');
const {textOf}=require('./textexact.cjs');
// Paths come from the environment. Poem data never lives in this repository.
const CORPUS = process.env.MIDST_CORPUS;
const OUTDIR = process.env.MIDST_OUT || require('path').join(require('os').tmpdir(), 'midst-converted');
if (!CORPUS) { console.error('MIDST_CORPUS is not set. Point it at a directory of .midst.zip files.'); process.exit(2); }
const step=(i,c)=>i.slice(0,c.front)+c.inserted+i.slice(i.length-c.end);
const ARCHIVE=CORPUS;
const OUT=OUTDIR;
fs.mkdirSync(OUT,{recursive:true});
const zips=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name); if(e.isDirectory())w(p); else if(e.name.endsWith('.midst.zip'))zips.push(p);}})(ARCHIVE);
zips.sort();
const rows=[];
for(const zip of zips){
  const name=path.basename(zip,'.midst.zip');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'midst-'));
  const t0=Date.now();
  try{
    // Pick the .midst entry STRUCTURALLY. 9 of 54 zips carry an internal name that differs
    // from the object name -- misspellings, nicknames, NFD accents, a doubled extension.
    // Matching on the object name made those look like missing data.
    const listing=execFileSync('unzip',['-Z','-1',zip],{encoding:'utf8'})
      .split('\n').map(s=>s.trim()).filter(Boolean)
      .filter(n=>n.endsWith('.midst')&&!n.startsWith('__MACOSX'));
    if(listing.length!==1) throw new Error(`expected exactly 1 .midst entry, found ${listing.length}: ${listing.slice(0,3)}`);
    // Extract WITHOUT naming the entry: an entry name passed back to unzip as an argument failed on one
    // accented name (archive #39 of 54). Take everything except __MACOSX, then find the file on disk.
    execFileSync('unzip',['-q','-j','-o',zip,'-x','__MACOSX/*','-d',tmp],{stdio:'pipe'});
    const extracted=fs.readdirSync(tmp).filter(n=>n.endsWith('.midst'));
    if(extracted.length!==1) throw new Error(`expected exactly 1 extracted .midst, found ${extracted.length}`);
    const old=fs.readFileSync(path.join(tmp,extracted[0]),'utf8');
    const parsed=JSON.parse(old);
    const frames=parsed.editorTimelineFrames;
    if(!Array.isArray(frames)) throw new Error('no editorTimelineFrames array; keys='+Object.keys(parsed).join(','));
    const converted=convertMidstFile(old);
    const {text,history}=JSON.parse(converted);
    let acc='',bad=0,firstBad=null,textBad=0;
    for(let i=0;i<history.length;i++){
      acc=step(acc,history[i]);
      const exp=normalise(frames[i].content);
      if(textOf(acc)!==textOf(frames[i].content))textBad++;
      if(acc!==exp){bad++; if(!firstBad)firstBad={i,expLen:exp.length,gotLen:acc.length,exp:exp.slice(0,120),got:acc.slice(0,120)};}
    }
    // control, per poem: a mid-history corruption must be detected
    let control=null;
    if(history.length>=3){
      const h=JSON.parse(JSON.stringify(history)); h[Math.max(0,Math.min(h.length-2,Math.floor(h.length/2)))].inserted+='\u0001';
      let a2='',b2=0;
      for(let i=0;i<h.length;i++){a2=step(a2,h[i]); if(a2!==normalise(frames[i].content))b2++;}
      control=b2>0;
    }
    fs.writeFileSync(path.join(OUT,`${name}.converted.midst`),converted);
    rows.push({name,frames:frames.length,hist:history.length,trajectoryBad:bad,textBad,firstBad,
               endpointOk:acc===text,control,oldMB:+(old.length/1048576).toFixed(2),
               newMB:+(converted.length/1048576).toFixed(3),ms:Date.now()-t0});
  }catch(e){ rows.push({name,error:`${e.constructor.name}: ${String(e.message).slice(0,160)}`,ms:Date.now()-t0}); }
  finally{ fs.rmSync(tmp,{recursive:true,force:true}); }
  const r=rows[rows.length-1];
  console.log(r.error?`ERR  ${r.name}  ${r.error}`
    :`${r.trajectoryBad===0&&r.textBad===0&&r.endpointOk?'PASS':'FAIL'} ${r.name.padEnd(44)} frames:${String(r.frames).padStart(6)} badFrames:${String(r.trajectoryBad).padStart(6)} textBad:${String(r.textBad).padStart(6)} endpoint:${r.endpointOk?'ok':'NO'} control:${r.control} ${String(r.oldMB).padStart(6)}MB->${String(r.newMB).padStart(6)}MB ${String(r.ms).padStart(6)}ms`);
}
fs.writeFileSync(path.join(OUT,'VERIFICATION.json'),JSON.stringify({generated:new Date().toISOString(),by:'violet-14057653',rows},null,1));
const ok=rows.filter(r=>!r.error&&r.trajectoryBad===0&&r.textBad===0&&r.endpointOk).length;
const bad=rows.filter(r=>!r.error&&(r.trajectoryBad>0||r.textBad>0||!r.endpointOk)).length;
const err=rows.filter(r=>r.error).length;
const ctl=rows.filter(r=>r.control===true).length, ctlN=rows.filter(r=>r.control!==null&&r.control!==undefined).length;
console.log(`\nPASS ${ok}   FAIL ${bad}   ERROR ${err}   of ${rows.length}`);
console.log(`controls fired: ${ctl}/${ctlN}  (a poem whose control did not fire has an INSENSITIVE check and its PASS means nothing)`);
