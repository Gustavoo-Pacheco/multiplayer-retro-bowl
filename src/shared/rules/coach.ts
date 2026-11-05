// Bot decisions for choices between plays.
import { yardsToGoal } from './downs';
import { fieldGoalInRange, type Choice, type MatchState } from './match';
import { T } from '../sim/tuning';

export function botChoice(m: MatchState, roll: number): Choice | null {
  switch (m.phase) {
    case 'choice4th': {
      const toGoal = yardsToGoal(m.ballX, m.attack[m.possession]);
      if (fieldGoalInRange(m) && (m.toGo > T.bot.goForItToGo || toGoal > 30)) return 'fg';
      if (m.toGo <= T.bot.goForItToGo && roll < T.bot.punchChance) return 'go';
      return fieldGoalInRange(m) ? 'fg' : 'punt';
    }
    case 'conversion': return roll < 0.15 && m.config.twoPoint ? 'two' : 'kick';
    case 'kickChoice': {
      const margin = m.score[m.kicker] - m.score[(1 - m.kicker) as 0 | 1];
      return margin < 0 && m.period >= 4 && m.clock < 60 ? 'onside' : 'deep';
    }
    default: return null;
  }
}
