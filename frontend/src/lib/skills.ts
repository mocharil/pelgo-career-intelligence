// Verified skills storage (localStorage)

const STORAGE_KEY = 'pelgo_verified_skills';

export interface VerifiedSkill {
  skill: string;
  score: number;
  verifiedAt: string;
}

export function getVerifiedSkills(): VerifiedSkill[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

export function isSkillVerified(skill: string): boolean {
  return getVerifiedSkills().some(v => v.skill.toLowerCase() === skill.toLowerCase());
}

export function getSkillScore(skill: string): number | null {
  const found = getVerifiedSkills().find(v => v.skill.toLowerCase() === skill.toLowerCase());
  return found ? found.score : null;
}

export function verifySkill(skill: string, score: number): void {
  const current = getVerifiedSkills();
  const existing = current.findIndex(v => v.skill.toLowerCase() === skill.toLowerCase());
  const entry: VerifiedSkill = { skill, score, verifiedAt: new Date().toISOString() };
  if (existing >= 0) {
    // Keep best score
    if (score > current[existing].score) current[existing] = entry;
  } else {
    current.push(entry);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}
