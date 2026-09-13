#!/usr/bin/env node
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {Effect} from 'effect';
import {installPackage} from './pel-install.js';
export function runPelInstallMain(argv:readonly string[],entryUrl:string=import.meta.url):Effect.Effect<number>{return Effect.gen(function*(){let prefix=join(homedir(),'.local/share/foreman');if(argv.length!==0&&(argv.length!==2||argv[0]!=='--prefix'||!argv[1])){yield* Effect.sync(()=>process.stderr.write('Use install.js [--prefix DIRECTORY].\n'));return 2;}if(argv.length===2)prefix=resolve(argv[1]!);const result=yield* installPackage({sourceRoot:fileURLToPath(new URL('../../',entryUrl)),prefix}).pipe(Effect.either);if(result._tag==='Left'){yield* Effect.sync(()=>process.stderr.write(`${result.left._tag}: ${result.left.message}\n`));return result.left._tag==='InstallIoFailure'?1:2;}yield* Effect.sync(()=>process.stdout.write(JSON.stringify(result.right)+'\n'));return 0;});}
if(process.argv[1]&&basename(fileURLToPath(import.meta.url))==='install.js'&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);try{process.exitCode=await Effect.runPromise(runPelInstallMain(process.argv.slice(2)),{signal:controller.signal});}catch{process.exitCode=controller.signal.aborted?4:1;}finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}}
