// The transcription above must still match upstream. Compare the option set, not the formatting.
//
// midst-editor keeps the poem schema in src/shared/poemExtensions.ts (one schema for the editor, replay and
// conversion, since its 83b2886) and the trailing-<br> rule in src/main/util.ts. MIDST_EDITOR_UTIL_TS names
// util.ts; the schema file is found beside it. A block that cannot be found is a failure, never an empty list
// compared against ours.
const fs=require('fs'),path=require('path');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const {logEvent,installUncaughtHandler}=require('./log.cjs');
installUncaughtHandler();
const utilPath=process.env.MIDST_EDITOR_UTIL_TS;
if(!utilPath){ console.log('set MIDST_EDITOR_UTIL_TS to midst-editor/src/main/util.ts'); logEvent('error','usage'); process.exit(2); }
// One event for every way upstream and the harness can disagree; `stage` says which.
const mismatch=(stage,count)=>{ logEvent('error','provenance-mismatch',count===undefined?{stage}:{stage,count}); process.exit(1); };
const schemaPath=path.join(path.dirname(utilPath),'..','shared','poemExtensions.ts');
const src=fs.readFileSync(utilPath,'utf8');
const schema=fs.readFileSync(schemaPath,'utf8');
// The text of `const <name> = [ ... ];` in s, or null.
const block=(s,name)=>{const at=s.indexOf(`const ${name} = [`); if(at<0) return null; const end=s.indexOf('];',at); return end<0?null:s.slice(at,end+2);};
const mine=fs.readFileSync(__dirname+'/normalise.cjs','utf8');
const opts=s=>[...s.matchAll(/([a-zA-Z]+):\s*(false|true)/g)].map(m=>`${m[1]}=${m[2]}`).sort();
const upBlock=block(schema,'poemExtensions'), myBlock=block(mine,'extensions');
if(!upBlock||!myBlock){ console.log(`PROVENANCE: ${!upBlock?`no "const poemExtensions = [" in ${schemaPath}`:'no "const extensions = [" in normalise.cjs'}`); mismatch('block-not-found'); }
const a=opts(upBlock), b=opts(myBlock);
if(a.length===0){ console.log(`PROVENANCE: no options found in the poemExtensions block of ${schemaPath}`); mismatch('no-options'); }
console.log('upstream options :',a.join(' '));
console.log('harness  options :',b.join(' '));
console.log('PROVENANCE MATCH :', JSON.stringify(a)===JSON.stringify(b));
if(JSON.stringify(a)!==JSON.stringify(b)) mismatch('options',a.filter(x=>!b.includes(x)).length+b.filter(x=>!a.includes(x)).length);
// The trailing-<br> rule must also be identical: normalise.cjs mirrors util.ts.
const rx = (t) => (t.match(/TRAILING_BREAK =\s*(\/.*\/gi);/) || [])[1];
const up = rx(src), here = rx(mine);
console.log('TRAILING_BREAK MATCH:', !!up && up === here);
if (!up || up !== here) mismatch('trailing-break');
// The zero-width rule must also be identical (midst-editor GitHub #31): each declaration, compared with all
// whitespace removed (the editor's formatter wraps them), and `export ` ignored.
const decl = (t, name) => {
  const at = t.search(new RegExp(`(?:export )?const ${name} =`));
  if (at < 0) return null;
  const end = t.indexOf(';\n', at);
  return end < 0 ? null : t.slice(at, end + 1).replace(/^export /, '').replace(/\s+/g, '');
};
for (const name of ['ZERO_WIDTH_CHARS', 'ZERO_WIDTH_ENTITY_CODES', 'ZERO_WIDTH_ENTITY', 'ZERO_WIDTH_ONLY_ELEMENT']) {
  const u = decl(src, name), h = decl(mine, name);
  console.log(`${name} MATCH:`, !!u && u === h);
  if (!u || u !== h) mismatch('zero-width');
}
