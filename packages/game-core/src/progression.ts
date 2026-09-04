export const xpForNextLevel = (level: number): number => Math.max(100, level * 100);

export interface ProgressionResult {
  level: number;
  xp: number;
  levelsGained: number;
}

export const grantXp = (level: number, xp: number, amount: number): ProgressionResult => {
  let nextLevel = level;
  let nextXp = xp + Math.max(0, amount);
  let levelsGained = 0;
  while (nextXp >= xpForNextLevel(nextLevel)) {
    nextXp -= xpForNextLevel(nextLevel);
    nextLevel += 1;
    levelsGained += 1;
  }
  return { level: nextLevel, xp: nextXp, levelsGained };
};
