import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
export function goProbe(source) {
 const root=resolve('apps/settlement');
 const dir=mkdtempSync(resolve(root,'.future-fixes-'));
 try {writeFileSync(resolve(dir,'main.go'),source);process.stdout.write(execFileSync('go',['run','./'+basename(dir)],{cwd:root,env:process.env}));}
 finally {rmSync(dir,{recursive:true,force:true});}
}
