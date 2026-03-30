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
  
  // Pick the most recent conversation
  const [cascadeId, summary] = entries[0];
  console.log(`Conversation: ${summary.summary}`);
  console.log(`ID: ${cascadeId}\n`);
  
  const traj = await client.getCascadeTrajectory(cascadeId, 1);
  const steps = traj?.trajectory?.steps || [];
  
  console.log(`Total steps: ${steps.length}\n`);
  
  let plannerCount = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const type = (step.type || '').replace('CORTEX_STEP_TYPE_', '');
    
    if (type === 'PLANNER_RESPONSE') {
      plannerCount++;
      const pr = step.plannerResponse || {};
      const thinkLen = (pr.thinking || '').length;
      const thinkPreview = (pr.thinking || '').substring(0, 200).replace(/\n/g, '\\n');
      const respLen = (pr.modifiedResponse || pr.response || '').length;
      const toolCalls = (pr.toolCalls || []).length;
      console.log(`[${i}] PLANNER_RESPONSE  thinking=${thinkLen}chars  response=${respLen}chars  toolCalls=${toolCalls}`);
      console.log(`    thinking preview: "${thinkPreview}..."`);
      if (toolCalls > 0) {
        for (const tc of pr.toolCalls) {
          console.log(`    toolCall: ${tc.name || 'unnamed'}`);
        }
      }
    } else {
      console.log(`[${i}] ${type}`);
    }
  }
  
  console.log(`\nTotal PLANNER_RESPONSE steps: ${plannerCount}`);
})().catch(e => console.error(e.message));
