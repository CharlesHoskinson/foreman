import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkPel} from '@foreman/pel';
import {createDefaultAuthoringSnapshotV1} from './pel-host-descriptors.js';
import {decodeForemanProjectV1} from './pel-project-config.js';
import {requiredPelPackagePaths} from './pel-package.js';
test('T-M6-023 all canonical workflow and exact profile examples check against the same installed language contract',async()=>{const snapshot=createDefaultAuthoringSnapshotV1();for(const path of requiredPelPackagePaths.filter(path=>path.startsWith('examples/')&&path.endsWith('.pel'))){const checked=checkPel({source:await readFile(path),snapshot});assert.equal(checked.tag,'ok',`${path}: ${JSON.stringify(checked)}`);}const settings=JSON.parse(await readFile('examples/pel/project-settings.json','utf8'));assert.equal(decodeForemanProjectV1(settings).ok,true);assert.equal(settings.roleBindings['role:implementer'].profileId,'grok-4.6');assert.equal(settings.roleBindings['role:reviewer'].profileId,'gpt-5.6-sol');assert.equal(settings.destinations&&Object.keys(settings.destinations).length,0);});
