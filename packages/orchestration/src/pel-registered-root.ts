/** Locate run state from the existing project registry without reading current settings. */
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,normalize} from 'node:path';
import {Effect} from 'effect';
import {loadProjectRegistryFileV1,type ProjectRegistryRecordV1} from './project-registry.js';
import {resolvePelRepository} from './pel-project-live.js';
import {pelFailure} from './pel-journal.js';
import type {PelRepositoryIdentityV1,RunFailure} from './pel-run-contract.js';

export interface PelRegisteredRootV1 {
  readonly projectId:string;
  readonly repository:PelRepositoryIdentityV1;
  readonly stateRoot:string;
  readonly worktreePath:string;
  readonly registration:ProjectRegistryRecordV1;
}
export function resolvePelRegisteredRoot(cwd:string,foremanHome:string,override?:string):Effect.Effect<PelRegisteredRootV1,RunFailure>{
  return Effect.gen(function*(){
    const location=yield* resolvePelRepository(cwd);
    return yield* Effect.try({try:()=>{
      const home=lstatSync(foremanHome);
      if(!isAbsolute(foremanHome)||normalize(foremanHome)!==foremanHome||realpathSync(foremanHome)!==foremanHome||!home.isDirectory()||home.isSymbolicLink())throw Error('home');
      const loaded=loadProjectRegistryFileV1(join(foremanHome,'projects.json'));if(loaded._tag!=='Valid')throw Error('registry');
      const matches=loaded.value.projects.filter(p=>p.state==='active'&&p.git_common_dir===location.repository.gitCommonDir&&(override===undefined||p.store_location===override));
      if(matches.length!==1)throw Error('association');const registration=matches[0]!;
      const stateRoot=registration.store_location,stat=lstatSync(stateRoot);
      if(!isAbsolute(stateRoot)||normalize(stateRoot)!==stateRoot||realpathSync(stateRoot)!==stateRoot||!stat.isDirectory()||stat.isSymbolicLink())throw Error('state root');
      return {projectId:registration.project_id,repository:location.repository,stateRoot,worktreePath:location.worktreePath,registration};
    },catch:()=>pelFailure('binding-mismatch','The requested state root has no matching active repository registration.')});
  });
}
