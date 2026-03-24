pub const LEVEL_LABELS: [&str; 6] = [
    "Unaware",
    "Novice",
    "Beginner",
    "Intermediate",
    "Advanced",
    "Elite",
];

pub const LEVEL_DESCRIPTIONS: [&str; 6] = [
    "Haven't touched it",
    "Know the concept exists, can describe it",
    "Can do with docs/guidance open",
    "Can do solo without reference",
    "Confident, could teach others",
    "Deep understanding, can debug edge cases",
];

use ratatui::style::Color;

pub const LEVEL_COLORS: [Color; 6] = [
    Color::DarkGray,
    Color::White,
    Color::Blue,
    Color::Cyan,
    Color::Green,
    Color::Yellow,
];

pub fn status_icon(status: &str) -> &'static str {
    match status {
        "planned" => "○",
        "in_progress" => "◉",
        "completed" => "✓",
        "abandoned" => "✗",
        _ => "○",
    }
}

pub fn clamp_level(level: i64) -> usize {
    if level < 0 {
        0
    } else if level > 5 {
        5
    } else {
        level as usize
    }
}

pub fn level_label(level: i64) -> &'static str {
    LEVEL_LABELS[clamp_level(level)]
}

pub fn level_bar(level: i64) -> String {
    let l = clamp_level(level);
    "█".repeat(l) + &"░".repeat(5 - l)
}
