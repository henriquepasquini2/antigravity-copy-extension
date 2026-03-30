const d = require('./out/discovery');
const { AntigravityLsClient } = require('./out/lsClient');

(async () => {
  const info = await d.discoverLanguageServer();
  const client = new AntigravityLsClient(info);
  
  const summaries = await client.getAllCascadeTrajectories();
  const entries = Object.entries(summaries);
  entries.sort((a, b) => {
    const tA = new Date(a[1].lastModifiedTime || a[1].createdTime).getTime();
    const tB = new Date(b[1].lastModifiedTime || b[1].createdTime).getTime();
    return tB - tA;
  });
  
  const [cascadeId] = entries[0];
  const traj = await client.getCascadeTrajectory(cascadeId, 1);
  const steps = traj?.trajectory?.steps || [];
  
  // Show full thinking for each planner response + the next step type
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;
    
    const pr = step.plannerResponse || {};
    const nextStep = steps[i + 1];
    const nextType = (nextStep?.type || '').replace('CORTEX_STEP_TYPE_', '');
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Step [${i}] PLANNER_RESPONSE → next: [${i+1}] ${nextType}`);
    console.log(`${'='.repeat(70)}`);
    
    if (pr.thinking) {
      console.log(`THINKING (${pr.thinking.length} chars):`);
      console.log('---');
      console.log(pr.thinking);
      console.log('---');
    } else {
      console.log('(no thinking)');
    }
    
    if (pr.modifiedResponse || pr.response) {
      const resp = pr.modifiedResponse || pr.response;
      console.log(`\nRESPONSE (${resp.length} chars):`);
      console.log('---');
      console.log(resp.substring(0, 300) + (resp.length > 300 ? '...[truncated]' : ''));
      console.log('---');
    }
  }
})().catch(e => console.error(e.message));
