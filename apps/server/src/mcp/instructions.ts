import connectionsGuide from './guides/connections.md';
import conversationsGuide from './guides/conversations.md';
import settingsGuide from './guides/settings.md';
import resultsGuide from './guides/results.md';
import interactionsGuide from './guides/interactions.md';
import updateSkill from '../../skills/update/SKILL.md';

export const INSTRUCTIONS_GUIDANCE =
  'Before using DotX tools for a task, read the relevant guidance with get_instructions. Reuse guidance already available in the current context.';

export const INSTRUCTION_GUIDES = {
  update: {
    title: 'Plan and coordinate a DotX update',
    description:
      'Coordinate the update from ChatGPT or dot: read release notes, resolve permissions, delegate local work and verify the result.',
    instructions: updateSkill,
  },
  connections: {
    title: 'Find connections and choose an interface',
    description:
      'Discover Macs, select an entry point and distinguish the three native interfaces.',
    instructions: connectionsGuide.trimEnd(),
  },
  conversations: {
    title: 'Create or continue a Codex conversation',
    description: 'Choose model and reasoning effort, write a prompt and dispatch work to Codex.',
    instructions: conversationsGuide.trimEnd(),
  },
  settings: {
    title: 'Change conversation permissions or Fast',
    description:
      'Apply desktop-owned settings and verify the permissions or Fast state that takes effect.',
    instructions: settingsGuide.trimEnd(),
  },
  results: {
    title: 'Confirm execution results or reconcile an uncertain outcome',
    description:
      'Interpret call responses, inspect exact-turn receipts and handle restarts without duplicate sends.',
    instructions: resultsGuide.trimEnd(),
  },
  interactions: {
    title: 'Receive progress and handle approvals or questions',
    description:
      'Subscribe to events, read notifications and answer blocking requests or asynchronous questions.',
    instructions: interactionsGuide.trimEnd(),
  },
  troubleshooting: {
    title: 'Troubleshoot installation, updates or runtime behavior',
    description: 'Find the maintained troubleshooting guide for problems using DotX.',
    instructions:
      'Read https://github.com/Vizards/DotX/blob/main/docs/troubleshooting/index.md and follow relevant links.',
  },
};

export type InstructionGoal = keyof typeof INSTRUCTION_GUIDES;

export function getInstructions(goal?: InstructionGoal) {
  if (goal) return { goal, ...INSTRUCTION_GUIDES[goal] };
  return {
    guides: Object.entries(INSTRUCTION_GUIDES).map(([goal, { title, description }]) => ({
      goal,
      title,
      description,
    })),
  };
}
