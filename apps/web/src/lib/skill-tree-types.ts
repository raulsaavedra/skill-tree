export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface DeckSummary {
  id: number;
  name: string;
  description?: string;
  card_count: number;
  covered_count: number;
  updated_at: string;
}

export interface ScenarioSummary {
  id: number;
  name: string;
  description?: string;
  repo_path?: string;
  status: "planned" | "in_progress" | "completed" | "abandoned" | string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface SkillNode {
  id: number;
  parent_id?: number;
  name: string;
  description?: string;
  level: SkillLevel;
  children?: SkillNode[];
  decks?: DeckSummary[];
  scenarios?: ScenarioSummary[];
  created_at: string;
  updated_at: string;
}

export interface ContextResponse {
  skills: SkillNode[];
  active_scenarios: ScenarioSummary[];
}

export interface Card {
  id: number;
  deck_id: number;
  question: string;
  answer: string;
  extra: string;
  choices: string[];
  correct_index?: number | null;
  tags: string[];
}
