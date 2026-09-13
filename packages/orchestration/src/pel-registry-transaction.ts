/** Bounded coordination over the original project registry across installation prefixes. */
import {constants,closeSync,openSync,mkdirSync,realpathSync,lstatSync,fstatSync} from 'node:fs';
import {dirname,isAbsolute,normalize} from 'node:path';
import {Effect} from 'effect';
import {acquireKernelDirectoryLock} from '@foreman/core';
import {pelFailure} from './pel-journal.js';
import type {RunFailure} from './pel-run-contract.js';
export function withPelRegistryTransaction<A,E,R>(foremanHome:string,operation:Effect.Effect<A,E,R>):Effect.Effect<A,E|RunFailure,R> {
 const io=<T>(read:()=>T)=>Effect.try({try:read,catch:()=>pelFailure('binding-mismatch','The original project registry transaction is busy or unavailable; admission was not changed.')});
 return Effect.scoped(Effect.gen(function*(){
  const fd=yield* Effect.acquireRelease(io(()=>{
   if(!isAbsolute(foremanHome)||normalize(foremanHome)!==foremanHome)throw Error('home');
   let ancestor=foremanHome;for(;;){try{if(realpathSync(ancestor)!==ancestor||!lstatSync(ancestor).isDirectory())throw Error('ancestor');break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;ancestor=dirname(ancestor);}}
   mkdirSync(foremanHome,{recursive:true,mode:0o700});
   if(realpathSync(foremanHome)!==foremanHome)throw Error('home');
   return openSync(foremanHome,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  }),handle=>Effect.sync(()=>closeSync(handle)));
  yield* Effect.acquireRelease(io(()=>{const held=acquireKernelDirectoryLock(fd,'.pel-registry-transaction','foreman.pel-registry-transaction.v1');if(!held)throw Error('busy');return held;}),held=>Effect.sync(held.release));
  yield* io(()=>{const opened=fstatSync(fd),named=lstatSync(foremanHome);if(opened.dev!==named.dev||opened.ino!==named.ino||named.isSymbolicLink())throw Error('changed');});
  return yield* operation;
 }));
}
