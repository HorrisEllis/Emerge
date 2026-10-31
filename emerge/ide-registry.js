'use strict';
/**
 * emerge/registry-components.js
 * comp_id: nexus.emerge.registry
 * uuid: nexus-emerge-registry-v1-0000-2026-0627-jamesbrooks-001
 */
const V='1.1.0';const NS='emerge';   // §5.4 fix 2026-08-08 — was 1.0.0, drifted from canonical lib/version.js's services.emerge (1.1.0)
function _c(id,method,path,desc,opts={}){
  return{id:`${NS}.${id}`,namespace:NS,name:id,version:V,
    grammar:opts.grammar||[id.replace(/\./g,' '),'emerge '+id.split('.')[0]],
    route:{method,path},description:desc,
    params:opts.params||[],tags:[NS,...(opts.tags||[])],
    permissions:opts.permissions||['system'],hooks:opts.hooks||{}};
}
module.exports=[
  _c('health',            'GET',  '/status',              'Emerge IDE health'),
  _c('compile',           'POST', '/compile',             'Compile .emerge spec → T0/T1/T2 pipeline', {
    tags:['build'],
    hooks:{
      in:[{id:'emerge.compiler.receive',intent:['build','compile','forge'],contract:'nexus-interaction-contract-v1::emerge',tags:['compiler']}],
      out:[{id:'emerge.compiler.complete',wires_to:['cortex.raid.feedback','guardian.job.dispatch.receive'],tags:['result']}],
    }}),
  _c('codegen',           'POST', '/api/codegen',         'Code generation from spec fragment', {tags:['build']}),
  _c('hot.load',          'POST', '/api/hot-load',        'Hot-patch a running module (QUARANTINE→PROVE→INTEGRATE→MONITOR)', {
    tags:['hot-load'],
    hooks:{in:[{id:'emerge.hot-load.receive',intent:['deploy','patch','hot-load'],tags:['hot-load']}]}}),
  _c('snapshot',          'POST', '/api/snapshot',        'Snapshot before applying patch', {tags:['snapshot']}),
  _c('check',             'POST', '/api/check',           'Pre-compile spec validation'),
  _c('models',            'GET',  '/api/models',          'Available Ollama models for compilation'),
  _c('files',             'GET',  '/api/files',           'File browser for spec loading'),
  _c('seams',             'GET',  '/api/seams',           'Active SEAM sessions for current file'),
];
