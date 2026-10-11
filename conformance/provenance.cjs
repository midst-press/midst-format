// The transcription above must still match upstream. Compare the option set, not the formatting.
const fs=require('fs');
const src=fs.readFileSync((process.env.MIDST_EDITOR_UTIL_TS || (()=>{throw new Error('set MIDST_EDITOR_UTIL_TS to midst-editor/src/main/util.ts')})()),'utf8');
const block=src.slice(src.indexOf('const extensions = ['), src.indexOf('];', src.indexOf('const extensions = ['))+2);
const mine=fs.readFileSync(__dirname+'/normalise.cjs','utf8');
const opts=s=>[...s.matchAll(/([a-zA-Z]+):\s*(false|true)/g)].map(m=>`${m[1]}=${m[2]}`).sort();
const a=opts(block), b=opts(mine.slice(mine.indexOf('const extensions = ['), mine.indexOf('];',mine.indexOf('const extensions = ['))+2));
console.log('upstream options :',a.join(' '));
console.log('harness  options :',b.join(' '));
console.log('PROVENANCE MATCH :', JSON.stringify(a)===JSON.stringify(b));
if(JSON.stringify(a)!==JSON.stringify(b)) process.exit(1);
// The trailing-<br> rule must also be identical: normalise.cjs mirrors util.ts.
const rx = (t) => (t.match(/TRAILING_BREAK = (\/.*\/gi);/) || [])[1];
const up = rx(src), here = rx(mine);
console.log('TRAILING_BREAK MATCH:', !!up && up === here);
if (!up || up !== here) process.exit(1);
