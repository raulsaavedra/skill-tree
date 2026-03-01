import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  skills: defineTable({
    id: v.number(),
    parent_id: v.optional(v.number()),
    name: v.string(),
    description: v.string(),
    level: v.number(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_skill_id", ["id"])
    .index("by_parent_id", ["parent_id"])
    .index("by_name", ["name"]),

  decks: defineTable({
    id: v.number(),
    name: v.string(),
    description: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_deck_id", ["id"])
    .index("by_name", ["name"]),

  cards: defineTable({
    id: v.number(),
    deck_id: v.number(),
    question: v.string(),
    answer: v.string(),
    extra: v.string(),
    choices: v.array(v.string()),
    correct_index: v.optional(v.number()),
    tags: v.array(v.string()),
  })
    .index("by_card_id", ["id"])
    .index("by_deck_id", ["deck_id"]),

  scenarios: defineTable({
    id: v.number(),
    name: v.string(),
    description: v.string(),
    repo_path: v.string(),
    status: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
    completed_at: v.optional(v.string()),
  })
    .index("by_scenario_id", ["id"])
    .index("by_status", ["status"])
    .index("by_name", ["name"]),

  deck_skills: defineTable({
    deck_id: v.number(),
    skill_id: v.number(),
  })
    .index("by_skill_id", ["skill_id"])
    .index("by_deck_id", ["deck_id"])
    .index("by_skill_deck", ["skill_id", "deck_id"]),

  scenario_skills: defineTable({
    scenario_id: v.number(),
    skill_id: v.number(),
  })
    .index("by_skill_id", ["skill_id"])
    .index("by_scenario_id", ["scenario_id"])
    .index("by_skill_scenario", ["skill_id", "scenario_id"]),

  card_coverage: defineTable({
    card_id: v.number(),
    covered_at: v.optional(v.string()),
  })
    .index("by_card_id", ["card_id"])
    .index("by_covered_at", ["covered_at"]),
});
