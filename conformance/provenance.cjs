// The transcription above must still match the library's source. Compare the option set, not the formatting.
//
// This repository keeps the poem schema in src/extensions.ts and the trailing-<br> and zero-width rules in
// src/convert.ts: the library's own source, which the conformance build bundles. normalise.cjs transcribes them
// and must not drift. The paths come from the repository; `--src <dir>` names another directory holding the same
// two files (the tests give it synthetic ones). A block that cannot be found is a failure, never an empty list
// compared against ours.
const fs=require('fs'),path=require('path');
// Errors are logged as JSONL on stderr (log.cjs, midst-format #38); stdout is the report.
const {logEvent,installUncaughtHandler}=require('./log.cjs');
installUncaughtHandler();
// One event for every way the library and the harness can disagree; `stage` says which.
const mismatch=(stage,count)=>{ logEvent('error','provenance-mismatch',count===undefined?{stage}:{stage,count}); process.exit(1); };
const argv=process.argv.slice(2);
let srcDir=path.join(__dirname,'..','src');
if(argv.length===2&&argv[0]==='--src') srcDir=path.resolve(argv[1]);
else if(argv.length!==0){ console.log('usage: node conformance/provenance.cjs [--src <dir holding extensions.ts and convert.ts>]'); logEvent('error','usage'); process.exit(2); }
const schemaPath=path.join(srcDir,'extensions.ts');
const src=fs.readFileSync(path.join(srcDir,'convert.ts'),'utf8');
const schema=fs.readFileSync(schemaPath,'utf8');
// The text of `const <name> = [ ... ];` in s, or null.
const block=(s,name)=>{const at=s.indexOf(`const ${name} = [`); if(at<0) return null; const end=s.indexOf('];',at); return end<0?null:s.slice(at,end+2);};
const mine=fs.readFileSync(__dirname+'/normalise.cjs','utf8');
const opts=s=>[...s.matchAll(/([a-zA-Z]+):\s*(false|true)/g)].map(m=>`${m[1]}=${m[2]}`).sort();
const upBlock=block(schema,'poemExtensions'), myBlock=block(mine,'extensions');
if(!upBlock||!myBlock){ console.log(`PROVENANCE: ${!upBlock?`no "const poemExtensions = [" in ${schemaPath}`:'no "const extensions = [" in normalise.cjs'}`); mismatch('block-not-found'); }
const a=opts(upBlock), b=opts(myBlock);
if(a.length===0){ console.log(`PROVENANCE: no options found in the poemExtensions block of ${schemaPath}`); mismatch('no-options'); }
console.log('library options :',a.join(' '));
console.log('harness  options :',b.join(' '));
console.log('PROVENANCE MATCH :', JSON.stringify(a)===JSON.stringify(b));
if(JSON.stringify(a)!==JSON.stringify(b)) mismatch('options',a.filter(x=>!b.includes(x)).length+b.filter(x=>!a.includes(x)).length);
// The trailing-<br> rule must also be identical: normalise.cjs mirrors convert.ts.
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
for (const name of ['ZERO_WIDTH_CHARS', 'ZERO_WIDTH_ENTITY_CODES', 'ZERO_WIDTH_ENTITY', 'ZERO_WIDTH_ONLY_ELEMENT', 'ZERO_WIDTH_TAGS', 'NOT_HIDDEN', 'SHOWN_ZERO_WIDTH_ELEMENT', 'ZERO_WIDTH_LINE_FILL', 'SHOWN_ZERO_WIDTH_LINE', 'ZERO_WIDTH_OR_TAG', 'EMPTY_HIDDEN_ELEMENT']) {
  const u = decl(src, name), h = decl(mine, name);
  console.log(`${name} MATCH:`, !!u && u === h);
  if (!u || u !== h) mismatch('zero-width');
}
// The invisible-paragraph rule likewise (midst-editor #169).
for (const name of ['INLINE_TAGS', 'NO_BOX_STYLE', 'INVISIBLE_PARAGRAPH']) {
  const u = decl(src, name), h = decl(mine, name);
  console.log(`${name} MATCH:`, !!u && u === h);
  if (!u || u !== h) mismatch('invisible-paragraph');
}
