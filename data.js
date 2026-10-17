// Generic starting template. A real client's plan lives in the database (client_config), never in this file.
const CLIENT = {
  name: "New client",
  startDate: "2026-01-05",
  startWeight: 200,
  goalWeight: 180,
  totalWeeks: 12,

  targets: { calories: 2400, protein: 160, fat: 55, fatCeiling: 65, carbs: 280, water: 120, steps: 10000 },

  // Turn any of these off to hide that feature for a client.
  features: { goalBar: true, streaks: true, offPlan: true, hungerEnergy: true, weeklyReview: true, photoReminder: true },

  coachNote: "",
  weeklyReview: { title: "Week 1 review", wins: "", focus: "" },

  weightLog: [],

  meals: [
    { name: "Morning", note: "", items: ["Add foods in the coach editor"], p: 0, f: 0, c: 0, cal: 0 },
    { name: "Pre-workout", note: "Eat about 1 hour before the gym.", items: ["Add foods in the coach editor"], p: 0, f: 0, c: 0, cal: 0 },
    { name: "Post-workout", note: "", items: ["Add foods in the coach editor"], p: 0, f: 0, c: 0, cal: 0 },
    { name: "Dinner", note: "", items: ["Add foods in the coach editor"], p: 0, f: 0, c: 0, cal: 0 }
  ],
  mealNote: "All amounts are raw/uncooked. Weigh before cooking.",

  // Index = day of week (0 = Sunday).
  schedule: ["Rest", "Push", "Pull", "Legs & Abs", "Push", "Pull", "Legs & Abs"],
  sets: 2,
  reps: 8,
  workouts: {
    "Push": ["Chest press", "Incline press", "Shoulder press", "Lateral raise", "Tricep extension"],
    "Pull": ["Lat pulldown", "Row", "Face pull", "Bicep curl"],
    "Legs & Abs": ["Squat", "Romanian deadlift", "Leg extension", "Calf raise", "Cable crunch"]
  },

  plan: [
    { h: "Training", p: "Log the weight and reps for every set. Add weight or reps when you can." },
    { h: "Nutrition", p: "Hit your protein, keep fat under the ceiling, and let carbs fill the rest. Your targets get re-set at each weigh-in." },
    { h: "Daily targets", p: "Steps, water, and a weigh-in every morning before you eat." },
    { h: "Rules", p: "Weigh food raw. If sleep, energy or gym performance drop, tell your coach right away." }
  ]
};
