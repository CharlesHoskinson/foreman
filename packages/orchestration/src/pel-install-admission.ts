/** Short admission transactions share the existing installation pointer lock. */
import {withPelRegistryTransaction} from './pel-registry-transaction.js';
import {realpathSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Effect} from 'effect';
import {withInstalledPrefix,readInstalledCurrent} from './pel-install.js';
import {pelFailure} from './pel-journal.js';
import type {PelAdmissionTransaction} from './pel-run-contract.js';

export function makePelInstalledAdmission(entryUrl:string,foremanHome:string):PelAdmissionTransaction {
 // Resolve the invoking file once, so a caller-supplied current symlink cannot
 // silently change this already-created runtime into a different build.
 const located=Effect.runSync(Effect.either(Effect.try({try:()=>{
   const entry=realpathSync(fileURLToPath(entryUrl)),root=resolve(dirname(entry),'../..');
   return basename(dirname(root))==='versions'?{prefix:dirname(dirname(root)),buildId:basename(root)}:null;
  },catch:()=>pelFailure('binding-mismatch','The invoking runtime location cannot be verified.')})));
 return operation=>withPelRegistryTransaction(foremanHome,Effect.gen(function*(){
  if(located._tag==='Left')return yield* Effect.fail(located.left);
  const location=located.right;
  if(location===null)return yield* operation;
  const result=yield* withInstalledPrefix(location.prefix,false,anchor=>Effect.gen(function*(){
   const current=yield* readInstalledCurrent(anchor);
   if(!/^[a-f0-9]{64}$/.test(location.buildId)||current!==`versions/${location.buildId}`)
    return yield* Effect.fail(pelFailure('binding-mismatch','This runtime is no longer selected. Invoke the current installed runtime before admission.'));
   // Keep arbitrary operation errors intact; only installation errors are mapped below.
   return yield* Effect.either(operation);
  })).pipe(Effect.mapError(error=>error._tag==='PelRunFailure'?error:pelFailure('binding-mismatch','Installation selection is busy or unavailable; admission was not changed.')));
  return yield* result._tag==='Left'?Effect.fail(result.left):Effect.succeed(result.right);
 }));
}
