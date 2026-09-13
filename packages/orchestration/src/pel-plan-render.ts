/** Human plan view. The complete machine contract remains PlanPreviewV1 via --json. */
import {canonicalize}from'@foreman/core';
import {formatPel,type PlanPreviewV1,type PelDataSchemaV1,type SourceSpan,type ValueSummaryV1}from'@foreman/pel';
export function renderPelPlan(preview:PlanPreviewV1,registry:Readonly<Record<string,PelDataSchemaV1>>,file:string):string {
 const schemaNames=new Map<string,string>();
 for(const[id,schema]of Object.entries(registry).sort(([a],[b])=>a.localeCompare(b,'en')))if(!schemaNames.has(canonicalize(schema)))schemaNames.set(canonicalize(schema),id);
 const definitions:{name:string;body:string}[]=[];
 const schemaName=(schema:PelDataSchemaV1|undefined,id?:string)=>{if(id)return id;if(!schema)return 'unspecified schema';const body=canonicalize(schema),existing=schemaNames.get(body);if(existing)return existing;const name=`S${definitions.length+1}`;definitions.push({name,body});schemaNames.set(body,name);return name;};
 const span=(value:SourceSpan)=>`${value.line}:${value.column}-${value.endLine}:${value.endColumn}`;
 const spans=(values:readonly SourceSpan[])=>values.map(span).join(', ')||'unknown location';
 const summary=(value:ValueSummaryV1):string=>value.kind==='known'?formatPel(value.value):value.kind==='callable'?`callable ${value.codeReferences.join(', ')}; remaining ${value.remainingArguments.join(', ')||'none'}`:`unresolved ${schemaName(value.schema,value.schemaId)}: ${value.reason} (at ${spans(value.originSpans)})`;
 const effectNames=new Map(preview.effects.map((effect,index)=>[effect.effectId,`E${index+1}`])),regionNames=new Map(preview.dynamicRegions.map((region,index)=>[region.regionId,`R${index+1}`]));
 const alias=(id:string)=>effectNames.get(id)??regionNames.get(id)??id;
 const list=(values:readonly string[])=>values.length?values.join(', '):'none';
 const lines=[`Plan ${JSON.stringify(file)}: ${preview.status}`,`Binding ${preview.bindingDigest}`,`Source ${preview.binding.sourceDigest}; policy ${preview.binding.policyDigest}`,`Result: ${summary(preview.finalValueSummary)}`,''];
 for(const effect of preview.effects){
  lines.push(`${effectNames.get(effect.effectId)} ${effect.registryId} at ${span(effect.span)}${effect.branch?`; branch ${effect.branch}`:''}${effect.regionId?`; region ${alias(effect.regionId)}`:''}`);
  lines.push(`  Arguments: ${Object.entries(effect.arguments).map(([name,value])=>`${name}=${summary(value)}`).join('; ')||'none'}`);
  if(effect.model)lines.push(`  Model: ${effect.model.profileId} via ${effect.model.transportId}; credential ${effect.model.credentialProfileRef}; controls ${effect.controlsSource}: ${canonicalize(effect.model.controls)}`);
  else lines.push('  Model: none (host operation)');
  lines.push(`  Capabilities: ${list(effect.capabilities)}; gates: ${list(effect.gates)}`);
  lines.push(`  Reads: ${list(effect.resources.reads)}; writes: ${list(effect.resources.writes)}${effect.resources.unknown?'; unknown resource scope (resolve within the admitted envelope before dispatch)':''}`);
 }
 lines.push('','Dependencies:');
 const dependencies=new Map<string,string[]>();for(const edge of preview.dependencies){const key=`${alias(edge.from)} -> ${alias(edge.to)}`,values=dependencies.get(key)??[];values.push(`${edge.kind}: ${edge.reason}`);dependencies.set(key,values);}
 if(!dependencies.size)lines.push('  none');else for(const[key,values]of dependencies)lines.push(`  ${key}: ${values.join('; ')}`);
 if(preview.dynamicRegions.length){lines.push('','Bounded dynamic regions (not a complete static execution graph):');for(const region of preview.dynamicRegions){
  lines.push(`  ${regionNames.get(region.regionId)} at ${spans(region.spans)}: ${region.reason}; possible effects ${list(region.possibleRegistryIds)}`);
  lines.push(`    Models: ${region.models.map(model=>`${model.profileId}/${model.transportId}`).join(', ')||'none'}; capabilities: ${list(region.capabilities)}`);
  lines.push(`    Reads: ${list(region.resources.reads)}; writes: ${list(region.resources.writes)}`);
  lines.push(`    Bounds: maxIterations=${region.maxIterations}, maxCalls=${region.maxCalls}, maxOutputBytes=${region.maxOutputBytes}, maxCostUnits=${region.maxCostUnits}, maxElapsedMs=${region.maxElapsedMs}; result ${schemaName(region.resultSchema)}`);
  for(const requirement of region.deferredRequirements)lines.push(`    Required before dispatch: ${requirement}`);
 }}
 if(definitions.length){lines.push('','Inline schema definitions:');for(const definition of definitions)lines.push(`  Schema ${definition.name}: ${definition.body}`);}
 if(preview.diagnostics.length){lines.push('','Diagnostics:');for(const diagnostic of preview.diagnostics)lines.push(`  ${diagnostic.severity} ${diagnostic.code} at ${span(diagnostic.span)}: ${diagnostic.message}; ${canonicalize({relatedSpans:diagnostic.relatedSpans,expectedForms:diagnostic.expectedForms,...(diagnostic.signature?{signature:diagnostic.signature}:{}),...(diagnostic.help?{help:diagnostic.help}:{}),...(diagnostic.bound?{bound:diagnostic.bound}:{}),...(diagnostic.consumed!==undefined?{consumed:diagnostic.consumed}:{})})}`);}
 lines.push('',`Global limits: ${canonicalize(preview.limits)}`,`Analysis consumed: ${canonicalize(preview.consumed)}`,'Plan constraints do not dispatch work or establish provider readiness. Use --json for complete schemas, bindings and effect identities.');
 return lines.join('\n')+'\n';
}
