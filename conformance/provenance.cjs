// The transcription above must still match upstream. Compare the option set, not the formatting.
//
// midst-editor keeps the poem schema in src/shared/poemExtensions.ts (one schema for the editor, replay and
// conversion, since its 83b2886) and the trailing-<br> rule in src/main/util.ts. MIDST_EDITOR_UTIL_TS names
// util.ts; the schema file is found beside it. A block that cannot be found is a failure, never an empty list
// compared against ours.
const fs=require('fs'),path=require('path');
const utilPath=process.env.MIDST_EDITOR_UTIL_TS || (()=>{throw new Error('set MIDST_EDITOR_UTIL_TS to midst-editor/src/main/util.ts')})();
const schemaPath=path.join(path.dirname(utilPath),'..','shared','poemExtensions.ts');
const src=fs.readFileSync(utilPath,'utf8');
const schema=fs.readFileSync(schemaPath,'utf8');
// The text of `const <name> = [ ... ];` in s, or null.
const block=(s,name)=>{const at=s.indexOf(`const ${name} = [`); if(at<0) return null; const end=s.indexOf('];',at); return end<0?null:s.slice(at,end+2);};
const mine=fs.readFileSync(__dirname+'/normalise.cjs','utf8');
const opts=s=>[...s.matchAll(/([a-zA-Z]+):\s*(false|true)/g)].map(m=>`${m[1]}=${m[2]}`).sort();
const upBlock=block(schema,'poemExtensions'), myBlock=block(mine,'extensions');
if(!upBlock||!myBlock){ console.log(`PROVENANCE: ${!upBlock?`no "const poemExtensions = [" in ${schemaPath}`:'no "const extensions = [" in normalise.cjs'}`); process.exit(1); }
const a=opts(upBlock), b=opts(myBlock);
if(a.length===0){ console.log(`PROVENANCE: no options found in the poemExtensions block of ${schemaPath}`); process.exit(1); }
console.log('upstream options :',a.join(' '));
console.log('harness  options :',b.join(' '));
console.log('PROVENANCE MATCH :', JSON.stringify(a)===JSON.stringify(b));
if(JSON.stringify(a)!==JSON.stringify(b)) process.exit(1);
// The trailing-<br> rule must also be identical: normalise.cjs mirrors util.ts.
const rx = (t) => (t.match(/TRAILING_BREAK =\s*(\/.*\/gi);/) || [])[1];
const up = rx(src), here = rx(mine);
console.log('TRAILING_BREAK MATCH:', !!up && up === here);
if (!up || up !== here) process.exit(1);
