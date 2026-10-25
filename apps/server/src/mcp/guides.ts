import packageInfo from '../../package.json' with { type: 'json' };
import index from '../../../../docs/index.md';
import server_install from '../../../../docs/server/install.md';
import server_update from '../../../../docs/server/update.md';
import codex_connect from '../../../../docs/codex/connect.md';
import codex_update from '../../../../docs/codex/update.md';
import dot from '../../../../docs/personal-agents/dot/index.md';
import cue from '../../../../docs/personal-agents/cue/index.md';
import authorization from '../../../../docs/personal-agents/authorization.md';
import access from '../../../../docs/common/access.md';
import handoff from '../../../../docs/common/handoff.md';
import connections from '../../../../docs/usage/connections.md';
import conversations from '../../../../docs/usage/conversations.md';
import settings from '../../../../docs/usage/settings.md';
import results from '../../../../docs/usage/results.md';
import interactions from '../../../../docs/usage/interactions.md';
import update from '../../../../docs/maintenance/update.md';
import remove from '../../../../docs/maintenance/remove.md';
import troubleshooting from '../../../../docs/troubleshooting/index.md';

export const INSTRUCTIONS_GUIDANCE =
  'Read get_instructions for the relevant task; omit goal for the complete guide index. Reuse guidance already in context.';
const sourceRoot = `https://github.com/Vizards/DotX/blob/v${packageInfo.version}/docs/`;
// Bundled Markdown keeps local links. MCP readers receive versioned absolute links.
function document(text: string, path: string) {
  return text
    .trimEnd()
    .replace(/(\[[^\]]*\]\()([^\s)]+)(\))/g, (match, before, href: string, after) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return match;
      return before + new URL(href, sourceRoot + path).href + after;
    });
}
function guide(title: string, path: string, instructions: string) {
  return {
    title,
    path,
    version: packageInfo.version,
    source: sourceRoot + path,
    instructions: document(instructions, path),
  };
}
export const INSTRUCTION_GUIDES = {
  server_install: guide('Install a Server', 'server/install.md', server_install),
  server_update: guide('Update Server and web pages', 'server/update.md', server_update),
  codex_connect: guide('Connect a local Codex', 'codex/connect.md', codex_connect),
  codex_update: guide('Update the local Codex plugin', 'codex/update.md', codex_update),
  dot: guide('Connect, configure or update dot', 'personal-agents/dot/index.md', dot),
  cue: guide('Connect, configure or update Cue', 'personal-agents/cue/index.md', cue),
  authorization: guide(
    'Personal Agent authorization, expiry and recovery',
    'personal-agents/authorization.md',
    authorization,
  ),
  access: guide('Check capabilities and management access', 'common/access.md', access),
  handoff: guide('Verify completion and hand off the next step', 'common/handoff.md', handoff),
  connections: guide('Find devices and choose an interface', 'usage/connections.md', connections),
  conversations: guide(
    'Create or continue a conversation',
    'usage/conversations.md',
    conversations,
  ),
  settings: guide('Change conversation permissions or Fast', 'usage/settings.md', settings),
  results: guide('Confirm results or reconcile an unknown outcome', 'usage/results.md', results),
  interactions: guide('Receive events and answer questions', 'usage/interactions.md', interactions),
  update: guide('Coordinate a component update', 'maintenance/update.md', update),
  remove: guide('Uninstall, reset or change service', 'maintenance/remove.md', remove),
  troubleshooting: guide(
    'Diagnose installation or runtime failures',
    'troubleshooting/index.md',
    troubleshooting,
  ),
};
export type InstructionGoal = keyof typeof INSTRUCTION_GUIDES;
export function getInstructions(goal?: InstructionGoal) {
  if (goal) return { goal, ...INSTRUCTION_GUIDES[goal] };
  return {
    ...guide('DotX agent guide', 'index.md', index),
    guides: Object.entries(INSTRUCTION_GUIDES).map(
      ([goal, { instructions: _instructions, ...metadata }]) => ({ goal, ...metadata }),
    ),
  };
}
